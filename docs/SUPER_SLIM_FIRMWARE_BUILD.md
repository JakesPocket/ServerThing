# Super Slim Firmware Build (ClientThing/Inputd)

This profile is intended for a firmware image focused on:

- `ssh`
- `clientthing` assets
- networking (`usb0`, DHCP, DNS, IP tools)
- `clientthing-inputd`

It disables GUI/Bluetooth/swap/Nix package manager/docs to keep image size low.

Treat `references/nixos-superbird/` as read-only upstream reference. Keep custom modules in your own repo (for example `ClientThing-firmware/firmware/`).

## Config File

Use:

- `ClientThing-firmware/firmware/clientthing-superslim.nix`

## How To Use In Your Flake

In your `modules = [ ... ];` list, add this module after `nixos-superbird.nixosModules.superbird`:

```nix
../../../../ClientThing-firmware/firmware/clientthing-superslim.nix
```

If your flake is outside this workspace, copy that file into your own repo and keep `assets = ./clientthing-assets;` valid.

## Build

```bash
nix build '.#nixosConfigurations.superbird.config.system.build.installer'
```

Optional size checks:

```bash
stat -c%s result/rootfs.img 2>/dev/null || stat -f%z result/rootfs.img
du -h result/rootfs.img
```

## Notes

- This is a headless profile (`superbird.gui.enable = false`), optimized for minimum footprint and firmware bridge duties.
- `clientthing-inputd` runs as a systemd service and uses:
  - `BRIDGE_SERVER_URL=http://127.0.0.1:3000`
  - `BRIDGE_DEVICE_ID=inputd`
- Assets are installed into `/usr/share/clientthing` by `clientthing-assets.service`.
