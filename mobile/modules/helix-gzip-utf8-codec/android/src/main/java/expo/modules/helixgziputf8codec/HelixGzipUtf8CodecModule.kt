package expo.modules.helixgziputf8codec

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Sync avoids a thread hop when reading Uint8Array; each window takes only a few ms.
class HelixGzipUtf8CodecModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("HelixGzipUtf8Codec")

    Function("gunzip") { input: ByteArray, outputLimit: Int ->
      gunzipBounded(input, outputLimit)
    }

    Function("decodeUtf8") { input: ByteArray ->
      decodeStrictUtf8(input)
    }
  }
}
