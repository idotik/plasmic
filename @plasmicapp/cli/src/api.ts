import { AuthConfig } from "./utils/config-utils";
import axios, { AxiosResponse, AxiosError } from "axios";
import socketio from "socket.io-client";
import { ProjectSyncMetadataModel } from "@plasmicapp/code-merger";
import { logger } from "./deps";

export class AppServerError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export interface ComponentBundle {
  renderModule: string;
  skeletonModule: string;
  cssRules: string;
  renderModuleFileName: string;
  skeletonModuleFileName: string;
  cssFileName: string;
  componentName: string;
  id: string;
  scheme: string;
  nameInIdToUuid: Array<[string, string]>;
}

export interface GlobalVariantBundle {
  id: string;
  name: string;
  contextModule: string;
  contextFileName: string;
}

export interface JsBundleTheme {
  themeFileName: string;
  themeModule: string;
  bundleName: string;
}

export interface ProjectMetaBundle {
  projectId: string;
  projectName: string;
  cssFileName: string;
  cssRules: string;
  jsBundleThemes: JsBundleTheme[];
}

export interface IconBundle {
  id: string;
  name: string;
  module: string;
  fileName: string;
}

export interface ProjectVersionMeta {
  projectId: string;
  version: string;
  projectName: string;
  componentIds: string[];
  iconIds: string[];
  dependencies: {
    [projectId: string]: string;
  };
}

export interface VersionResolution {
  projects: ProjectVersionMeta[];
  dependencies: ProjectVersionMeta[];
  conflicts: ProjectVersionMeta[];
}

export interface ProjectBundle {
  components: ComponentBundle[];
  projectConfig: ProjectMetaBundle;
  globalVariants: GlobalVariantBundle[];
  usedTokens: StyleTokensMap;
  iconAssets: IconBundle[];
}

export type ProjectMeta = Omit<ProjectBundle, "projectConfig">;

export interface StyleConfigResponse {
  defaultStyleCssFileName: string;
  defaultStyleCssRules: string;
}

export interface StyleTokensMap {
  props: {
    name: string;
    type: string;
    value: string | number;
    meta: {
      projectId: string;
      id: string;
    };
  }[];
  global: {
    meta: {
      source: "plasmic.app";
    };
  };
}

export interface ProjectIconsResponse {
  version: string;
  icons: IconBundle[];
}

export class PlasmicApi {
  constructor(private auth: AuthConfig) {}

  async genStyleConfig(): Promise<StyleConfigResponse> {
    const result = await this.post(
      `${this.auth.host}/api/v1/code/style-config`
    );
    return result.data as StyleConfigResponse;
  }

  /**
   * Sync resolution - Given a fuzzy idea of what the user wants,
   * (i.e. a versionRange and component names),
   * ask the server for the exact references for a later call to `projectComponents`
   * - For components specified in the parameters - the server will return the latest version that satisfies the versionRange
   * - Any conflicting versions will be returned in `conflicts`, and should cause the client's sync to abort
   * @param projects
   * @param recursive
   */
  async resolveSync(
    projects: {
      projectId: string;
      versionRange: string;
      componentIdOrNames: readonly string[] | undefined;
    }[],
    recursive?: boolean
  ): Promise<VersionResolution> {
    const resp: any = await this.post(
      `${this.auth.host}/api/v1/code/resolve-sync`,
      {
        projects,
        recursive,
      }
    );
    const versionResolution = resp.data as VersionResolution;
    return { ...versionResolution };
  }

  /**
   * Code-gen endpoint.
   * This will fetch components at an exact specified version.
   * If you don't know what version should be used, call `resolveSync` first.
   * @param projectId
   * @param cliVersion
   * @param reactWebVersion
   * @param newCompScheme
   * @param existingCompScheme
   * @param componentIdOrNames
   * @param version
   */
  async projectComponents(
    projectId: string,
    cliVersion: string,
    reactWebVersion: string | undefined,
    newCompScheme: "blackbox" | "direct",
    // The list of existing components as [componentUuid, codeScheme]
    existingCompScheme: Array<[string, "blackbox" | "direct"]>,
    componentIdOrNames: readonly string[] | undefined,
    version: string
  ): Promise<ProjectBundle> {
    const result = await this.post(
      `${this.auth.host}/api/v1/projects/${projectId}/code/components`,
      {
        cliVersion,
        reactWebVersion: reactWebVersion || "",
        newCompScheme,
        existingCompScheme,
        componentIdOrNames,
        version,
      }
    );
    return result.data as ProjectBundle;
  }

  async uploadBundle(
    projectId: string,
    bundleName: string,
    bundleJs: string,
    css: string[],
    metaJson: string,
    genModulePath: string | undefined,
    genCssPaths: string[],
    pkgVersion: string | undefined,
    extraPropMetaJson: string | undefined,
    themeProviderWrapper: string | undefined,
    themeModule: string | undefined
  ): Promise<StyleTokensMap> {
    const result = await this.post(
      `${this.auth.host}/api/v1/projects/${projectId}/jsbundle/upload`,
      {
        projectId,
        bundleName,
        bundleJs,
        css,
        metaJson,
        genModulePath,
        genCssPaths,
        pkgVersion,
        extraPropMetaJson,
        themeProviderWrapper,
        themeModule,
      }
    );
    return result.data as StyleTokensMap;
  }

  async projectStyleTokens(
    projectId: string,
    versionRange?: string
  ): Promise<StyleTokensMap> {
    const result = await this.post(
      `${this.auth.host}/api/v1/projects/${projectId}/code/tokens`,
      { versionRange }
    );
    return result.data as StyleTokensMap;
  }

  async projectIcons(
    projectId: string,
    versionRange?: string,
    iconIds?: string[]
  ): Promise<ProjectIconsResponse> {
    const result = await this.post(
      `${this.auth.host}/api/v1/projects/${projectId}/code/icons`,
      { versionRange, iconIds }
    );
    return result.data as ProjectIconsResponse;
  }

  async projectSyncMetadata(
    projectId: string,
    revision: number,
    rethrowAppError: boolean
  ): Promise<ProjectSyncMetadataModel> {
    const result = await this.post(
      `${this.auth.host}/api/v1/projects/${projectId}/code/project-sync-metadata`,
      { revision },
      rethrowAppError
    );
    return ProjectSyncMetadataModel.fromJson(result.data);
  }

  connectSocket(): SocketIOClient.Socket {
    const socket = socketio.connect(this.auth.host, {
      path: `/api/v1/socket`,
      transportOptions: {
        polling: {
          extraHeaders: this.makeHeaders(),
        },
      },
    });
    return socket;
  }

  // If rethrowAppError is true, we will throw an exception with the error
  // message
  private async post(url: string, data?: any, rethrowAppError?: boolean) {
    try {
      return await axios.post(url, data, {
        headers: this.makeHeaders(),
      });
    } catch (e) {
      const error = e as AxiosError;
      if (error.response && error.response.status === 403) {
        logger.error(
          `Incorrect Plasmic credentials; please check your .plasmic.auth file.`
        );
        process.exit(1);
      }
      if (error.response && error.response.data) {
        let message: string = "";
        if (error.response.data.error) {
          message = error.response.data.error.message;
        } else {
          message = `Error: request failed with status code ${error.response.status}. The response is
  ${error.response.data}`;
        }
        if (rethrowAppError) {
          throw new AppServerError(message);
        }
        logger.error(message);
        process.exit(1);
      } else {
        throw e;
      }
    }
  }

  private makeHeaders() {
    const headers: Record<string, string> = {
      "x-plasmic-api-user": this.auth.user,
      "x-plasmic-api-token": this.auth.token,
    };

    if (this.auth.basicAuthUser && this.auth.basicAuthPassword) {
      const authString = Buffer.from(
        `${this.auth.basicAuthUser}:${this.auth.basicAuthPassword}`
      ).toString("base64");
      headers["Authorization"] = `Basic ${authString}`;
    }

    return headers;
  }
}
