import { CustomError } from '@celljs/core';
/**
 * Custom error types for installation process
 */
/**
 * Base class for all installation errors
 */
export declare class InstallError extends CustomError {
    constructor(message: string);
}
/**
 * Network-related errors (download failures, timeouts, DNS errors)
 */
export declare class NetworkError extends InstallError {
    constructor(message?: string);
}
/**
 * Permission errors (EACCES, insufficient privileges)
 */
export declare class PermissionError extends InstallError {
    constructor(message?: string);
}
/**
 * Disk space errors (ENOSPC)
 */
export declare class DiskSpaceError extends InstallError {
    constructor(message?: string);
}
/**
 * File system errors (file not found, directory not found)
 */
export declare class FileSystemError extends InstallError {
    constructor(message?: string);
}
/**
 * Version-related errors (version fetch, invalid version)
 */
export declare class VersionError extends InstallError {
    constructor(message: string);
}
/**
 * Archive extraction errors (corrupted archives, extraction failures)
 */
export declare class ExtractionError extends InstallError {
    constructor(message?: string);
}
