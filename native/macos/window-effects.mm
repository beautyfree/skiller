#import <Cocoa/Cocoa.h>

static NSString *const kElectrobunVibrancyViewIdentifier =
    @"ElectrobunVibrancyView";
static NSString *const kElectrobunNativeDragViewIdentifier =
    @"ElectrobunNativeDragView";

@interface ElectrobunNativeDragView : NSView
@end

@implementation ElectrobunNativeDragView
- (BOOL)isOpaque {
  return NO;
}

- (void)drawRect:(NSRect)dirtyRect {
  (void)dirtyRect;
}

- (void)mouseDown:(NSEvent *)event {
  NSWindow *window = [self window];
  if (window == nil || event == nil) {
    return;
  }
  // Match green traffic-light zoom: Electrobun maximize() / isMaximized() are unreliable here.
  if ([event clickCount] == 2) {
    [window zoom:nil];
    return;
  }
  [window performWindowDragWithEvent:event];
}
@end

static NSVisualEffectView *findVibrancyView(NSView *contentView) {
  for (NSView *subview in [contentView subviews]) {
    if ([subview isKindOfClass:[NSVisualEffectView class]] &&
        [[subview identifier]
            isEqualToString:kElectrobunVibrancyViewIdentifier]) {
      return (NSVisualEffectView *)subview;
    }
  }

  return nil;
}

static ElectrobunNativeDragView *findNativeDragView(NSView *contentView) {
  for (NSView *subview in [contentView subviews]) {
    if ([subview isKindOfClass:[ElectrobunNativeDragView class]] &&
        [[subview identifier]
            isEqualToString:kElectrobunNativeDragViewIdentifier]) {
      return (ElectrobunNativeDragView *)subview;
    }
  }

  return nil;
}

/**
 * Run UI work on the main queue. Never use dispatch_sync(main) when already on
 * the main thread — Bun/Electrobun RPC can run on the main thread and would deadlock.
 */
static void agentSkillsRunOnMain(void (^block)(void)) {
  if ([NSThread isMainThread]) {
    block();
  } else {
    dispatch_sync(dispatch_get_main_queue(), block);
  }
}

static BOOL applyWindowVibrancy(NSWindow *window) {
  if (![window isKindOfClass:[NSWindow class]]) {
    return NO;
  }

  [window setOpaque:NO];
  [window setBackgroundColor:[NSColor clearColor]];
  [window setTitlebarAppearsTransparent:YES];
  [window setHasShadow:YES];

  NSView *contentView = [window contentView];
  if (contentView == nil) {
    return NO;
  }

  NSVisualEffectView *effectView = findVibrancyView(contentView);

  if (effectView == nil) {
    effectView = [[NSVisualEffectView alloc]
        initWithFrame:[contentView bounds]];
    [effectView setIdentifier:kElectrobunVibrancyViewIdentifier];
    [effectView setAutoresizingMask:(NSViewWidthSizable | NSViewHeightSizable)];
  }

  /* UnderWindowBackground samples the desktop behind the window — required for a visible
     wallpaper blur with transparent NSWindow + WKWebView. WindowBackground reads as a flat
     frosted fill when the web stack paints high-opacity tints on top. Pre-11: Sidebar. */
  if (@available(macOS 11.0, *)) {
    [effectView setMaterial:NSVisualEffectMaterialUnderWindowBackground];
  } else {
    [effectView setMaterial:NSVisualEffectMaterialSidebar];
  }
  [effectView setBlendingMode:NSVisualEffectBlendingModeBehindWindow];
  [effectView setState:NSVisualEffectStateActive];

  if ([effectView superview] == nil) {
    NSView *relativeView = [[contentView subviews] firstObject];
    if (relativeView != nil) {
      [contentView addSubview:effectView
                   positioned:NSWindowBelow
                   relativeTo:relativeView];
    } else {
      [contentView addSubview:effectView];
    }
  }

  [window invalidateShadow];
  return YES;
}

static BOOL removeWindowVibrancy(NSWindow *window) {
  if (![window isKindOfClass:[NSWindow class]]) {
    return NO;
  }

  NSView *contentView = [window contentView];
  if (contentView != nil) {
    NSVisualEffectView *effectView = findVibrancyView(contentView);
    if (effectView != nil) {
      [effectView removeFromSuperview];
    }
  }

  [window setOpaque:YES];
  [window setBackgroundColor:[NSColor windowBackgroundColor]];
  // Keep YES: matches titleBarStyle "hiddenInset" — NO draws the system title bar strip.
  [window setTitlebarAppearsTransparent:YES];
  [window setHasShadow:YES];
  [window invalidateShadow];
  return YES;
}

extern "C" bool enableWindowVibrancy(void *windowPtr) {
  if (windowPtr == nullptr) {
    return false;
  }

  __block BOOL success = NO;
  agentSkillsRunOnMain(^{
    success = applyWindowVibrancy((__bridge NSWindow *)windowPtr);
  });

  return success;
}

extern "C" bool setWindowVibrancyEnabled(void *windowPtr, bool enabled) {
  if (windowPtr == nullptr) {
    return false;
  }

  __block BOOL success = NO;
  agentSkillsRunOnMain(^{
    NSWindow *window = (__bridge NSWindow *)windowPtr;
    success = enabled ? applyWindowVibrancy(window) : removeWindowVibrancy(window);
  });

  return success;
}

/**
 * Align NSWindow chrome with in-app theme so NSVisualEffectMaterialUnderWindowBackground
 * composites correctly (especially forced dark UI while macOS is in light appearance).
 * appearanceMode: 0 = follow system, 1 = light (Aqua), 2 = dark (Dark Aqua).
 */
extern "C" bool setWindowChromeAppearance(void *windowPtr, int32_t appearanceMode) {
  if (windowPtr == nullptr) {
    return false;
  }

  __block BOOL success = NO;
  agentSkillsRunOnMain(^{
    NSWindow *window = (__bridge NSWindow *)windowPtr;
    if (![window isKindOfClass:[NSWindow class]]) {
      return;
    }

    if (appearanceMode == 1) {
      [window setAppearance:[NSAppearance appearanceNamed:NSAppearanceNameAqua]];
    } else if (appearanceMode == 2) {
      [window setAppearance:[NSAppearance appearanceNamed:NSAppearanceNameDarkAqua]];
    } else {
      [window setAppearance:nil];
    }

    [window invalidateShadow];
    success = YES;
  });

  return success;
}

extern "C" bool ensureWindowShadow(void *windowPtr) {
  if (windowPtr == nullptr) {
    return false;
  }

  __block BOOL success = NO;
  agentSkillsRunOnMain(^{
    NSWindow *window = (__bridge NSWindow *)windowPtr;
    if (![window isKindOfClass:[NSWindow class]]) {
      return;
    }

    [window setHasShadow:YES];
    [window invalidateShadow];
    success = YES;
  });

  return success;
}

extern "C" bool setWindowTrafficLightsPosition(void *windowPtr, double x,
                                               double yFromTop) {
  if (windowPtr == nullptr) {
    return false;
  }

  __block BOOL success = NO;
  agentSkillsRunOnMain(^{
    NSWindow *window = (__bridge NSWindow *)windowPtr;
    if (![window isKindOfClass:[NSWindow class]]) {
      return;
    }

    NSButton *closeButton =
        [window standardWindowButton:NSWindowCloseButton];
    NSButton *minimizeButton =
        [window standardWindowButton:NSWindowMiniaturizeButton];
    NSButton *zoomButton = [window standardWindowButton:NSWindowZoomButton];

    if (closeButton == nil || minimizeButton == nil || zoomButton == nil) {
      return;
    }

    NSView *buttonContainer = [closeButton superview];
    if (buttonContainer == nil) {
      return;
    }

    CGFloat spacing = NSMinX(minimizeButton.frame) - NSMinX(closeButton.frame);
    if (spacing <= 0) {
      spacing = closeButton.frame.size.width + 6.0;
    }

    BOOL flipped = [buttonContainer isFlipped];
    CGFloat targetY = yFromTop;
    if (!flipped) {
      targetY = buttonContainer.frame.size.height - yFromTop -
                closeButton.frame.size.height;
    }
    targetY = MAX(0.0, targetY);

    CGFloat currentX = x;
    NSArray *buttons = @[ closeButton, minimizeButton, zoomButton ];
    for (NSButton *button in buttons) {
      [button setFrameOrigin:NSMakePoint(currentX, targetY)];
      currentX += spacing;
    }

    [buttonContainer setNeedsLayout:YES];
    [buttonContainer layoutSubtreeIfNeeded];
    [window invalidateShadow];
    success = YES;
  });

  return success;
}

/** Same as double-clicking the title bar / zoom button — toggles AppKit zoomed frame. */
extern "C" bool toggleWindowZoom(void *windowPtr) {
  if (windowPtr == nullptr) {
    return false;
  }

  __block BOOL success = NO;
  agentSkillsRunOnMain(^{
    NSWindow *window = (__bridge NSWindow *)windowPtr;
    if (![window isKindOfClass:[NSWindow class]]) {
      return;
    }
    [window zoom:nil];
    success = YES;
  });

  return success;
}

extern "C" bool setNativeWindowDragRegion(void *windowPtr, double x,
                                          double height) {
  if (windowPtr == nullptr) {
    return false;
  }

  __block BOOL success = NO;
  agentSkillsRunOnMain(^{
    NSWindow *window = (__bridge NSWindow *)windowPtr;
    if (![window isKindOfClass:[NSWindow class]]) {
      return;
    }

    NSView *contentView = [window contentView];
    if (contentView == nil) {
      return;
    }

    CGFloat dragX = MAX(0.0, x);
    CGFloat dragHeight = MAX(0.0, height);
    CGFloat dragWidth = MAX(0.0, contentView.bounds.size.width - dragX);
    if (dragHeight <= 0.0 || dragWidth <= 0.0) {
      return;
    }

    BOOL flipped = [contentView isFlipped];
    CGFloat dragY = flipped ? 0.0 : contentView.bounds.size.height - dragHeight;
    dragY = MAX(0.0, dragY);

    ElectrobunNativeDragView *dragView = findNativeDragView(contentView);
    if (dragView == nil) {
      dragView = [[ElectrobunNativeDragView alloc] initWithFrame:NSZeroRect];
      [dragView setIdentifier:kElectrobunNativeDragViewIdentifier];
    }

    [dragView setFrame:NSMakeRect(dragX, dragY, dragWidth, dragHeight)];
    [dragView setAutoresizingMask:NSViewWidthSizable];

    if ([dragView superview] == nil) {
      [contentView addSubview:dragView
                   positioned:NSWindowAbove
                   relativeTo:nil];
    }

    success = YES;
  });

  return success;
}
