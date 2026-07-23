package com.meetmobile

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

/**
 * Registers PipModule. Kept as its own module instance so MainActivity can hand
 * the system PiP callback back to the exact instance JS is listening on.
 */
class PipPackage : ReactPackage {
    var module: PipModule? = null
        private set

    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
        val m = PipModule(reactContext)
        module = m
        return listOf(m)
    }

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
        emptyList()
}
