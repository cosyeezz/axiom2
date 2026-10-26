/** Registry pack downloads a published tarball, not an installation or a local package build. */
export declare function downloadNpmPluginPackage(name: string, selector: string, target: string, registry?: string, progress?: (message: string) => void): Promise<string>;
