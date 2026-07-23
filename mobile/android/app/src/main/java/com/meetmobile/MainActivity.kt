package com.meetmobile

import android.content.res.Configuration
import android.os.Build
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

  override fun getMainComponentName(): String = "MeetMobile"

  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

  private fun pipModule() = (application as? MainApplication)?.pipPackage?.module

  /**
   * Pressing home during a call enters Picture-in-Picture, so the call keeps
   * playing in a floating window and the camera keeps capturing (a fully
   * backgrounded activity would freeze your video for everyone else).
   *
   * CRUCIAL ORDERING. We tell JS to collapse to the video-only view HERE, before
   * entering PiP — not from onPictureInPictureModeChanged, which fires after the
   * system has already snapshotted and scaled the surface. Emit-then-enter loses
   * that race intermittently (clean one time, cluttered the next). Emitting on
   * the home-press gives React a head start to render the minimal view before
   * the surface is captured.
   */
  override fun onUserLeaveHint() {
    super.onUserLeaveHint()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
        PipModule.active &&
        !isInPictureInPictureMode) {
      pipModule()?.emitPipChanged(true)
      try {
        enterPictureInPictureMode()
      } catch (_: Throwable) {
      }
    }
  }

  override fun onPictureInPictureModeChanged(
    isInPictureInPictureMode: Boolean,
    newConfig: Configuration,
  ) {
    super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
    pipModule()?.emitPipChanged(isInPictureInPictureMode)
  }

  /**
   * The guaranteed restore. Whenever the activity is resumed AND not in PiP, we
   * are unambiguously in the foreground full-screen, so the collapse must be
   * off. This also recovers if we collapsed on a home-press that never actually
   * became PiP (permission off, odd OEM). Idempotent, so calling it on every
   * resume is fine.
   */
  override fun onResume() {
    super.onResume()
    if (!isInPictureInPictureMode) pipModule()?.emitPipChanged(false)
  }
}
