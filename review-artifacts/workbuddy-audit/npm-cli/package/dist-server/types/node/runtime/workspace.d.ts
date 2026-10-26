import { Workspace, WorkspaceFolder } from '@genie/runtime';
export declare class CliWorkspace implements Workspace {
    private readonly cwdService;
    get workspaceFolders(): readonly WorkspaceFolder[];
}
