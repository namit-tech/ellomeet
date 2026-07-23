package com.meetmobile

import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.segmentation.Segmentation
import com.google.mlkit.vision.segmentation.SegmentationMask
import com.google.mlkit.vision.segmentation.selfie.SelfieSegmenterOptions
import com.oney.WebRTCModule.videoEffects.VideoFrameProcessor
import com.oney.WebRTCModule.videoEffects.VideoFrameProcessorFactoryInterface
import org.webrtc.JavaI420Buffer
import org.webrtc.SurfaceTextureHelper
import org.webrtc.VideoFrame
import java.nio.ByteBuffer

/**
 * Replaces everything behind the speaker with a flat colour.
 *
 * WHY THIS WORKS ON YUV DIRECTLY. The obvious implementation converts each
 * frame to a Bitmap, composites in RGB, and converts back. That is two full
 * colour-space conversions per frame, per participant, on a phone — it is the
 * reason naive virtual backgrounds cook the battery.
 *
 * A *solid* background needs neither. A flat colour is a constant in YUV just
 * as it is in RGB, so background pixels can be written straight into the Y/U/V
 * planes: set luma to the colour's Y, and both chroma planes to neutral 128.
 * Foreground pixels are copied through untouched. No RGB, no Bitmap, no
 * allocation beyond the output buffer.
 *
 * This is exactly why solid colours were the right first effect to ship. Blur
 * cannot take this shortcut: it has to read neighbouring pixels, so it needs a
 * real image and ideally a GPU pass.
 *
 * MASK ORIENTATION is the subtle part. ML Kit is trained on upright faces, so
 * the frame's rotation has to be passed in or segmentation quality collapses
 * when the phone is held normally (front cameras usually report 270°). But the
 * mask then comes back in *upright* space while the planes we are editing are
 * in *sensor* space, so every lookup has to be mapped back. See maskIndex().
 */
class SolidBackgroundProcessor(private val lumaValue: Int) : VideoFrameProcessor {

    private val segmenter = Segmentation.getClient(
        SelfieSegmenterOptions.Builder()
            // STREAM_MODE reuses state between frames, which is both faster and
            // steadier than treating every frame as a fresh photo.
            .setDetectorMode(SelfieSegmenterOptions.STREAM_MODE)
            .build()
    )

    // Reused across frames so a 30fps call is not also a 30-per-second
    // allocation of multi-megabyte arrays.
    private var nv21: ByteArray? = null

    override fun process(frame: VideoFrame, textureHelper: SurfaceTextureHelper): VideoFrame {
        val src = frame.buffer.toI420() ?: return frame

        try {
            val width = src.width
            val height = src.height
            val rotation = frame.rotation

            val mask = segmentOrNull(src, width, height, rotation)
                // Segmentation failed or timed out: pass the frame through
                // untouched rather than dropping it. A momentarily missing
                // effect is far better than a stalled video.
                ?: return frame

            val maskBuf = mask.buffer
            val maskW = mask.width
            val maskH = mask.height

            val dst = JavaI420Buffer.allocate(width, height)
            writePlanes(src, dst, width, height, rotation, maskBuf, maskW, maskH)

            return VideoFrame(dst, frame.rotation, frame.timestampNs)
        } catch (t: Throwable) {
            // Never let an effect take the call down with it.
            android.util.Log.w(TAG, "background effect failed, passing frame through", t)
            return frame
        } finally {
            src.release()
        }
    }

    private fun segmentOrNull(
        src: VideoFrame.I420Buffer,
        width: Int,
        height: Int,
        rotation: Int,
    ): SegmentationMask? {
        val buf = nv21ForFrame(src, width, height)
        val image = InputImage.fromByteArray(
            buf, width, height, rotation, InputImage.IMAGE_FORMAT_NV21
        )
        return try {
            // The frame thread must not run ahead of the mask, or foreground
            // and background would be composited from different moments.
            Tasks.await(segmenter.process(image))
        } catch (t: Throwable) {
            null
        }
    }

    /** I420 (planar Y, U, V) to NV21 (planar Y, then interleaved V/U). */
    private fun nv21ForFrame(
        src: VideoFrame.I420Buffer,
        width: Int,
        height: Int,
    ): ByteArray {
        val size = width * height * 3 / 2
        val out = nv21?.takeIf { it.size == size } ?: ByteArray(size).also { nv21 = it }

        val y = src.dataY
        val u = src.dataU
        val v = src.dataV
        val strideY = src.strideY
        val strideU = src.strideU
        val strideV = src.strideV

        var o = 0
        for (row in 0 until height) {
            y.position(row * strideY)
            y.get(out, o, width)
            o += width
        }

        val cw = width / 2
        val ch = height / 2
        for (row in 0 until ch) {
            for (col in 0 until cw) {
                out[o++] = v.get(row * strideV + col)
                out[o++] = u.get(row * strideU + col)
            }
        }
        return out
    }

    /**
     * Copy the person through and paint the rest flat.
     *
     * Chroma is written at half resolution (4:2:0), so the chroma loop samples
     * the mask at the corresponding luma position rather than its own.
     */
    private fun writePlanes(
        src: VideoFrame.I420Buffer,
        dst: JavaI420Buffer,
        width: Int,
        height: Int,
        rotation: Int,
        maskBuf: ByteBuffer,
        maskW: Int,
        maskH: Int,
    ) {
        val sy = src.dataY
        val su = src.dataU
        val sv = src.dataV
        val dy = dst.dataY
        val du = dst.dataU
        val dv = dst.dataV

        val luma = lumaValue.toByte()
        val neutral = 128.toByte()

        maskBuf.rewind()
        val floats = maskBuf.asFloatBuffer()

        for (row in 0 until height) {
            val srcRow = row * src.strideY
            val dstRow = row * dst.strideY
            for (col in 0 until width) {
                val idx = maskIndex(col, row, width, height, rotation, maskW, maskH)
                // ML Kit reports confidence that the pixel IS the person.
                val isPerson = idx >= 0 && floats.get(idx) > FOREGROUND_THRESHOLD
                dy.put(dstRow + col, if (isPerson) sy.get(srcRow + col) else luma)
            }
        }

        val cw = width / 2
        val ch = height / 2
        for (row in 0 until ch) {
            for (col in 0 until cw) {
                val idx = maskIndex(col * 2, row * 2, width, height, rotation, maskW, maskH)
                val isPerson = idx >= 0 && floats.get(idx) > FOREGROUND_THRESHOLD
                du.put(row * dst.strideU + col, if (isPerson) su.get(row * src.strideU + col) else neutral)
                dv.put(row * dst.strideV + col, if (isPerson) sv.get(row * src.strideV + col) else neutral)
            }
        }
    }

    /**
     * Map a pixel in sensor space to its index in the upright mask.
     *
     * ML Kit rotated the image before segmenting it, so the mask is upright
     * while the planes we are writing are not. Without this the effect looks
     * like it is masking a completely different scene — which, in mask space,
     * it is.
     */
    private fun maskIndex(
        x: Int,
        y: Int,
        width: Int,
        height: Int,
        rotation: Int,
        maskW: Int,
        maskH: Int,
    ): Int {
        val (mx, my) = when (rotation) {
            90 -> Pair(height - 1 - y, x)
            180 -> Pair(width - 1 - x, height - 1 - y)
            270 -> Pair(y, width - 1 - x)
            else -> Pair(x, y)
        }
        if (mx < 0 || my < 0 || mx >= maskW || my >= maskH) return -1
        return my * maskW + mx
    }

    companion object {
        private const val TAG = "SolidBackground"

        // Deliberately above 0.5: on a phone camera it is far less jarring to
        // lose a few edge pixels of the person than to leave stray patches of
        // the real room floating in a flat background.
        private const val FOREGROUND_THRESHOLD = 0.6f

        // Video luma range is 16–235, not 0–255. Using 0/255 produces
        // out-of-range values that some encoders and players clip oddly.
        const val LUMA_BLACK = 16
        const val LUMA_WHITE = 235

        const val EFFECT_BLACK = "bg-black"
        const val EFFECT_WHITE = "bg-white"

        /** Register both effects so JS can select them by name. */
        fun register() {
            com.oney.WebRTCModule.videoEffects.ProcessorProvider.addProcessor(
                EFFECT_BLACK,
                VideoFrameProcessorFactoryInterface { SolidBackgroundProcessor(LUMA_BLACK) }
            )
            com.oney.WebRTCModule.videoEffects.ProcessorProvider.addProcessor(
                EFFECT_WHITE,
                VideoFrameProcessorFactoryInterface { SolidBackgroundProcessor(LUMA_WHITE) }
            )
        }
    }
}
