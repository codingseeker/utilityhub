import {
  LOCAL_OPERATIONS,
  LocalFileAdapter,
  LocalProcessingError,
} from "./LocalFileAdapter.js";
import { OFFICE_TO_PDF_MESSAGE, isOfficeFile } from "./fileTypes.js";

export const FILE_SERVICE_RUNTIMES = Object.freeze({
  LOCAL: "local",
  CLOUD: "cloud",
});

/**
 * FileServiceRouter decides where bytes are allowed to go before any network
 * call is made.
 *
 * Routing rules:
 *  - A .docx or .pptx file always resolves to LocalFileAdapter, even if a
 *    caller asks for a cloud operation. LocalFileAdapter then rejects
 *    unsupported conversions with the Office-to-PDF message.
 *  - The four Office tools always resolve to LocalFileAdapter.
 *  - Everything else resolves to the existing cloud workflow.
 */
export const FileServiceRouter = {
  isLocalOperation(operationId) {
    return Object.prototype.hasOwnProperty.call(LOCAL_OPERATIONS, operationId);
  },

  route({ operationId, files = [] } = {}) {
    const officeFiles = files.filter(isOfficeFile);
    if (officeFiles.length > 0) {
      return {
        runtime: FILE_SERVICE_RUNTIMES.LOCAL,
        adapter: LocalFileAdapter,
        reason: "office-file",
        officeFiles,
      };
    }
    if (this.isLocalOperation(operationId)) {
      return {
        runtime: FILE_SERVICE_RUNTIMES.LOCAL,
        adapter: LocalFileAdapter,
        reason: "local-operation",
        officeFiles: [],
      };
    }
    return {
      runtime: FILE_SERVICE_RUNTIMES.CLOUD,
      adapter: null,
      reason: "cloud-operation",
      officeFiles: [],
    };
  },

  requiresLocalProcessing({ operationId, files = [] } = {}) {
    return this.route({ operationId, files }).runtime === FILE_SERVICE_RUNTIMES.LOCAL;
  },

  assertCloudSafe(files = []) {
    if (files.some(isOfficeFile)) {
      throw new LocalProcessingError(
        "Office files are processed in this browser and are never uploaded to Cloud Storage or the API.",
        { code: "LOCAL_ONLY_FILE" },
      );
    }
  },

  async processLocal({ operationId, files = [], onStage } = {}) {
    const route = this.route({ operationId, files });
    if (route.runtime !== FILE_SERVICE_RUNTIMES.LOCAL) {
      throw new LocalProcessingError(
        "This operation needs the cloud workflow, not the local adapter.",
        { code: "CLOUD_OPERATION" },
      );
    }
    return route.adapter.process({ operationId, files, onStage });
  },

  unsupportedOfficePdfError() {
    return new LocalProcessingError(OFFICE_TO_PDF_MESSAGE, {
      code: "OFFICE_PDF_UNSUPPORTED",
    });
  },
};

export { LocalFileAdapter, LocalProcessingError, LOCAL_OPERATIONS, OFFICE_TO_PDF_MESSAGE };
