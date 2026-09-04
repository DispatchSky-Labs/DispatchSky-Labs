import AppKit

let sourceFolder = URL(fileURLWithPath: "/Users/sam/Code/Flight Dispatch Question Bank/Marketing/Reddit Campaign 2026-08")
let outputFolder = URL(fileURLWithPath: "/Users/sam/Documents/Codex/Sadiom-Research-Implementation/research/campaign-assets")

func load(_ name: String) -> NSImage {
    guard let image = NSImage(contentsOf: sourceFolder.appendingPathComponent(name)) else { fatalError("Missing \(name)") }
    return image
}

func rounded(_ rect: NSRect, radius: CGFloat) -> NSBezierPath { NSBezierPath(roundedRect: rect, xRadius: radius, yRadius: radius) }

func drawText(_ value: String, in rect: NSRect, size: CGFloat, weight: NSFont.Weight, color: NSColor, lineHeight: CGFloat? = nil) {
    let paragraph = NSMutableParagraphStyle()
    paragraph.lineBreakMode = .byWordWrapping
    if let lineHeight { paragraph.minimumLineHeight = lineHeight; paragraph.maximumLineHeight = lineHeight }
    let attributes: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: size, weight: weight), .foregroundColor: color, .paragraphStyle: paragraph, .kern: -0.4]
    NSAttributedString(string: value, attributes: attributes).draw(with: rect, options: [.usesLineFragmentOrigin, .usesFontLeading])
}

func aspectFill(_ image: NSImage, in rect: NSRect) {
    let sourceRatio = image.size.width / image.size.height
    let destinationRatio = rect.width / rect.height
    var crop = NSRect(origin: .zero, size: image.size)
    if sourceRatio > destinationRatio {
        crop.size.width = image.size.height * destinationRatio
        crop.origin.x = (image.size.width - crop.size.width) / 2
    } else {
        crop.size.height = image.size.width / destinationRatio
        crop.origin.y = (image.size.height - crop.size.height) / 2
    }
    image.draw(in: rect, from: crop, operation: .sourceOver, fraction: 1)
}

func render(width: Int, height: Int, name: String) {
    let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    bitmap.size = NSSize(width: width, height: height)
    let context = NSGraphicsContext(bitmapImageRep: bitmap)!
    NSGraphicsContext.saveGraphicsState(); NSGraphicsContext.current = context
    let canvas = NSRect(x: 0, y: 0, width: width, height: height)
    aspectFill(load("background-dispatcher.png"), in: canvas)
    NSColor(calibratedWhite: 0.01, alpha: 0.70).setFill(); canvas.fill()
    let gradient = NSGradient(colors: [NSColor(calibratedWhite: 0.01, alpha: 0.92), NSColor.clear])!
    gradient.draw(in: NSRect(x: 0, y: 0, width: CGFloat(width), height: CGFloat(height) * 0.80), angle: 90)

    let margin = CGFloat(width) * 0.075
    let iconSize = CGFloat(width) * 0.105
    let iconRect = NSRect(x: margin, y: CGFloat(height) - margin - iconSize, width: iconSize, height: iconSize)
    NSGraphicsContext.saveGraphicsState()
    rounded(iconRect, radius: iconSize * 0.22).addClip(); load("app-icon.png").draw(in: iconRect, from: .zero, operation: .sourceOver, fraction: 1)
    NSGraphicsContext.restoreGraphicsState()
    drawText("FLIGHT DISPATCH STUDY", in: NSRect(x: margin + iconSize + margin * 0.35, y: iconRect.minY + iconSize * 0.22, width: CGFloat(width) * 0.70, height: 70), size: CGFloat(width) * 0.027, weight: .bold, color: .white)

    drawText("PRIVATE INVITATION", in: NSRect(x: margin, y: CGFloat(height) * 0.69, width: CGFloat(width) * 0.8, height: 70), size: CGFloat(width) * 0.026, weight: .bold, color: NSColor(calibratedRed: 0.48, green: 0.90, blue: 0.82, alpha: 1))
    drawText("FLIGHT DISPATCH STUDY\nFOUNDING CIRCLE", in: NSRect(x: margin, y: CGFloat(height) * 0.40, width: CGFloat(width) * 0.86, height: CGFloat(height) * 0.30), size: CGFloat(width) * 0.073, weight: .heavy, color: .white, lineHeight: CGFloat(width) * 0.078)

    let benefitY = CGFloat(height) * 0.305
    NSColor(calibratedRed: 0.05, green: 0.18, blue: 0.20, alpha: 0.90).setFill(); rounded(NSRect(x: margin, y: benefitY, width: CGFloat(width) - margin * 2, height: CGFloat(height) * 0.105), radius: 16).fill()
    drawText("FULL QUESTION-BANK ACCESS", in: NSRect(x: margin * 1.35, y: benefitY + CGFloat(height) * 0.047, width: CGFloat(width) * 0.82, height: 54), size: CGFloat(width) * 0.029, weight: .bold, color: .white)
    drawText("for selected participants during participation", in: NSRect(x: margin * 1.35, y: benefitY + CGFloat(height) * 0.012, width: CGFloat(width) * 0.82, height: 54), size: CGFloat(width) * 0.022, weight: .medium, color: NSColor.white.withAlphaComponent(0.78))

    drawText("INVITATIONS ARE LIMITED", in: NSRect(x: margin, y: CGFloat(height) * 0.095, width: CGFloat(width) * 0.85, height: 70), size: CGFloat(width) * 0.027, weight: .bold, color: NSColor(calibratedRed: 0.90, green: 0.74, blue: 0.43, alpha: 1))
    drawText("Share your experience", in: NSRect(x: margin, y: CGFloat(height) * 0.050, width: CGFloat(width) * 0.82, height: 60), size: CGFloat(width) * 0.022, weight: .medium, color: .white)
    context.flushGraphics(); NSGraphicsContext.restoreGraphicsState()
    guard let data = bitmap.representation(using: .png, properties: [:]) else { fatalError("PNG encoding failed") }
    try! data.write(to: outputFolder.appendingPathComponent(name))
}

render(width: 1200, height: 1500, name: "reddit-direction-a-4x5.png")
render(width: 1200, height: 1200, name: "reddit-direction-a-square.png")
