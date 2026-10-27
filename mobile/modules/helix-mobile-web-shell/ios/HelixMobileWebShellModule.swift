import ExpoModulesCore
import QuickLook

public class HelixMobileWebShellModule: Module {
  private var pdfPreview: MobileWebShellPdfPreview?

  public func definition() -> ModuleDefinition {
    Name("HelixMobileWebShell")

    AsyncFunction("presentPdf") { (url: URL) in
      guard let presenter = self.appContext?.utilities?.currentViewController() else {
        throw PdfPresenterUnavailableException()
      }
      let preview = MobileWebShellPdfPreview(url: url)
      let controller = QLPreviewController()
      controller.dataSource = preview
      self.pdfPreview = preview
      presenter.present(controller, animated: true)
    }.runOnQueue(.main)

    View(HelixMobileWebShellView.self) {
      Events("onLoadState", "onBridgeMessage", "onExternalNavigation")

      Prop("generationDirectory") { (view: HelixMobileWebShellView, value: String) in
        view.setGenerationDirectory(value)
      }

      Prop("sessionId") { (view: HelixMobileWebShellView, value: String) in
        view.setSessionId(value)
      }

      Prop("bridgeEnabled") { (view: HelixMobileWebShellView, value: Bool) in
        view.setBridgeEnabled(value)
      }

      AsyncFunction("postBridgeMessage") {
        (view: HelixMobileWebShellView, json: String, promise: Promise) in
        try view.postBridgeMessage(json, promise: promise)
      }

      OnViewDidUpdateProps { (view: HelixMobileWebShellView) in
        view.propsDidUpdate()
      }
    }
  }
}
