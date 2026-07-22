# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Add any project specific keep options here:

# ---------------------------------------------------------------------------
# WebRTC / LiveKit
#
# These classes are instantiated and called from native code via JNI, so R8
# cannot see any reference to them and will happily strip them. The result is a
# release build that compiles cleanly and then crashes the moment a call starts.
#
# Written ahead of need: minifyEnabled is currently false (see build.gradle).
# ---------------------------------------------------------------------------
-keep class org.webrtc.** { *; }
-keep class io.livekit.** { *; }
-keep class com.oney.WebRTCModule.** { *; }
-keep class livekit.** { *; }
-dontwarn org.webrtc.**
-dontwarn io.livekit.**

# Protobuf, used by LiveKit's signalling.
-keep class com.google.protobuf.** { *; }
-dontwarn com.google.protobuf.**
