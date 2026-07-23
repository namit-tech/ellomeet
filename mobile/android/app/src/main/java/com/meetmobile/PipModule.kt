package com.meetmobile

import android.app.PictureInPictureParams
import android.os.Build
import android.util.Rational
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * Picture-in-Picture bridge.
 *
 * Two jobs:
 *   1. Let JS say "a call is live, PiP is allowed now" (setActive). We do not
 *      want the join screen shrinking into a floating window, only an active
 *      call.
 *   2. Let JS drive the collapse: when Android puts us in PiP the UI should
 *      drop everything but the video, and restore when we come back. MainActivity
 *      forwards the system callback here and we emit it to JS.
 *
 * Why PiP matters for the "frozen face" problem: when the app is sent to the
 * background normally, the activity stops and camera capture stops with it, so
 * everyone else sees your last frame frozen. In PiP the activity stays visible
 * (merely paused), so the camera keeps running and your video keeps flowing to
 * the room while you use another app. PiP is the fix for both asks at once.
 */
class PipModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "PipModule"

    companion object {
        // Read by MainActivity to decide whether to enter PiP on home-press.
        // Volatile: written from the JS thread, read from the UI thread.
        @Volatile
        var active = false
            private set
    }

    /** Turn PiP on while a call is mounted, off when it unmounts. */
    @ReactMethod
    fun setActive(value: Boolean) {
        active = value
        // Android 12+ can enter PiP seamlessly on home-press without us calling
        // enterPictureInPictureMode by hand — but only if the params are set
        // with autoEnter while we are still in the foreground. Refresh them now.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            reactContext.currentActivity?.let { act ->
                try {
                    act.setPictureInPictureParams(buildParams(true))
                } catch (_: Throwable) {
                    // Some OEM builds throw if called at an odd moment; harmless.
                }
            }
        }
    }

    /** Enter PiP immediately, e.g. from an in-call button. */
    @ReactMethod
    fun enter() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        reactContext.currentActivity?.let { act ->
            try {
                act.enterPictureInPictureMode(buildParams(false))
            } catch (_: Throwable) {
            }
        }
    }

    @ReactMethod
    fun addListener(eventName: String) {
        // Required for RN's NativeEventEmitter; no bookkeeping needed here.
    }

    @ReactMethod
    fun removeListeners(count: Int) {
    }

    private fun buildParams(autoEnter: Boolean): PictureInPictureParams {
        val builder = PictureInPictureParams.Builder()
            .setAspectRatio(Rational(9, 16)) // portrait call tile
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            builder.setAutoEnterEnabled(autoEnter)
            builder.setSeamlessResizeEnabled(true)
        }
        return builder.build()
    }

    /** Called by MainActivity when the system enters/leaves PiP. */
    fun emitPipChanged(inPip: Boolean) {
        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit("PipModeChanged", inPip)
    }
}
