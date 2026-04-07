import SwiftUI
import CoreImage.CIFilterBuiltins

/// Generates a QR code image for an arbitrary string. Uses CoreImage's
/// built-in `CIQRCodeGenerator` so we don't pull in any third-party deps.
struct QRCodeImage: View {
    let text: String
    var size: CGFloat = 360

    var body: some View {
        if let image = Self.generate(text: text) {
            Image(uiImage: image)
                .interpolation(.none)
                .resizable()
                .scaledToFit()
                .frame(width: size, height: size)
        } else {
            RoundedRectangle(cornerRadius: 16)
                .fill(Theme.card)
                .frame(width: size, height: size)
                .overlay(
                    Text("QR")
                        .font(Theme.display(48, weight: .black))
                        .foregroundColor(Theme.muted)
                )
        }
    }

    private static func generate(text: String) -> UIImage? {
        guard !text.isEmpty else { return nil }
        let context = CIContext()
        let filter  = CIFilter.qrCodeGenerator()
        filter.message = Data(text.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage else { return nil }
        let scaled = output.transformed(by: CGAffineTransform(scaleX: 12, y: 12))
        guard let cg = context.createCGImage(scaled, from: scaled.extent) else { return nil }
        return UIImage(cgImage: cg)
    }
}
