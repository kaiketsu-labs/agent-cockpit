#!/bin/sh
set -e

# Render assets/sidebar.svg to 2x assets/sidebar.png (960x1080) for VS Code Marketplace
# Uses native macOS AppKit via a transient compiled binary to avoid any external npm or python dependencies.

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SVG_PATH="$ROOT_DIR/assets/sidebar.svg"
PNG_PATH="$ROOT_DIR/assets/sidebar.png"
BIN_PATH="/tmp/cockpit_render_svg_$$"

trap 'rm -f "$BIN_PATH"' EXIT

clang -framework Foundation -framework AppKit -o "$BIN_PATH" -x objective-c - << 'EOF'
#import <AppKit/AppKit.h>

int main(int argc, const char * argv[]) {
    @autoreleasepool {
        if (argc < 3) return 1;
        NSString *inPath = [NSString stringWithUTF8String:argv[1]];
        NSString *outPath = [NSString stringWithUTF8String:argv[2]];
        CGFloat targetW = argc > 3 ? atof(argv[3]) : 960.0;
        CGFloat targetH = argc > 4 ? atof(argv[4]) : 1080.0;

        NSImage *svg = [[NSImage alloc] initWithContentsOfFile:inPath];
        if (!svg) {
            fprintf(stderr, "Error: Failed to load SVG file: %s\n", argv[1]);
            return 1;
        }

        NSBitmapImageRep *rep = [[NSBitmapImageRep alloc]
            initWithBitmapDataPlanes:NULL
                          pixelsWide:(NSInteger)targetW
                          pixelsHigh:(NSInteger)targetH
                       bitsPerSample:8
                     samplesPerPixel:4
                            hasAlpha:YES
                            isPlanar:NO
                      colorSpaceName:NSDeviceRGBColorSpace
                         bytesPerRow:0
                        bitsPerPixel:0];
        [rep setSize:NSMakeSize(targetW, targetH)];

        [NSGraphicsContext saveGraphicsState];
        [NSGraphicsContext setCurrentContext:[NSGraphicsContext graphicsContextWithBitmapImageRep:rep]];
        [[NSGraphicsContext currentContext] setImageInterpolation:NSImageInterpolationHigh];
        [svg drawInRect:NSMakeRect(0, 0, targetW, targetH)
               fromRect:NSZeroRect
              operation:NSCompositingOperationCopy
               fraction:1.0];
        [NSGraphicsContext restoreGraphicsState];

        NSData *pngData = [rep representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
        if (!pngData || ![pngData writeToFile:outPath atomically:YES]) {
            fprintf(stderr, "Error: Failed to write PNG file: %s\n", argv[2]);
            return 1;
        }
        printf("✅ Successfully rendered %s -> %s (%.0fx%.0f)\n", argv[1], argv[2], targetW, targetH);
    }
    return 0;
}
EOF

"$BIN_PATH" "$SVG_PATH" "$PNG_PATH" 960 1080
