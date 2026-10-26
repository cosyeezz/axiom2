# __PACKAGE_NAME__

This ordinary CBC package installs a workflow member and a browser member through the existing PluginManager.
Members keep separate identities, data, entry paths and enable controls. The workflow Skill is manually invoked.

```sh
cbc plugin build . --output ../bundle-dist
cbc plugin pack ../bundle-dist --output ../bundle.tgz
cbc plugin --profile web import ../bundle.tgz --no-enable
```

The root `bundle.layers` array is ordered. Later declarations override `enabled` and replace the entire `options` object for the same package-relative member path.
The team layer replaces the workflow's base options, so `detail` is not retained.
Member package source is included in the archive; no registry or source checkout is required on the receiving host.
Change the declaration and install the new exact bundle version to apply a configuration layer.
Installing does not execute members. Browser members require explicit source trust before activation.
DSH YAML patches, JavaScript expressions and arbitrary loader nodes are not supported by this JSON data contract.
Keep credentials out of the bundle and configure sensitive values locally.
