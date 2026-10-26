# CBC Appearance Studio

This client-only package registers three complete light/dark palettes through the public `theme` service and exposes a persistent picker in the native `settings.after` slot. Selection is stored by the Mod's declaration store and is reapplied through the host skin painter; stopping the package removes the themes, picker and selection layer without changing native theme data.
