package com.meetmobile

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.oney.WebRTCModule.WebRTCModuleOptions

class MainApplication : Application(), ReactApplication {

  // Held so MainActivity can forward the system PiP callback to the same module
  // instance JS is listening on.
  val pipPackage = PipPackage()

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          add(pipPackage)
        },
    )
  }

  override fun onCreate() {
    super.onCreate()

    // Screen sharing needs a foreground service, and this flag is what starts
    // it. It defaults to false, which fails in a way that looks like success:
    // capture begins, the "Presenting" tile appears, and then Android tears the
    // projection down the moment the app is backgrounded — which is exactly
    // when you start presenting something. Since Android 14, a MediaProjection
    // without a matching foreground service is not permitted to keep running.
    WebRTCModuleOptions.getInstance().enableMediaProjectionService = true

    // Virtual backgrounds. Registered by name here so JS can switch between
    // them with track._setVideoEffect(name) without any further bridging.
    SolidBackgroundProcessor.register()

    loadReactNative(this)
  }
}
