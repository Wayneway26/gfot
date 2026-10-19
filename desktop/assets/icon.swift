import AppKit
let image = NSImage(size: NSSize(width: 1024, height: 1024))
image.lockFocus()
NSColor(calibratedRed: 0.94, green: 0.96, blue: 0.91, alpha: 1).setFill()
NSBezierPath(roundedRect: NSRect(x: 0, y: 0, width: 1024, height: 1024), xRadius: 225, yRadius: 225).fill()
NSColor(calibratedRed: 0.19, green: 0.32, blue: 0.23, alpha: 1).setFill()
NSBezierPath(roundedRect: NSRect(x: 90, y: 90, width: 844, height: 844), xRadius: 170, yRadius: 170).fill()
let text = "g" as NSString
let attrs: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: 770, weight: .semibold), .foregroundColor: NSColor(calibratedRed: 0.89, green: 0.94, blue: 0.77, alpha: 1)]
let size = text.size(withAttributes: attrs)
text.draw(at: NSPoint(x: (1024-size.width)/2, y: (1024-size.height)/2+88), withAttributes: attrs)
image.unlockFocus()
let rep = NSBitmapImageRep(data: image.tiffRepresentation!)!
try rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
