import { Request } from "./request.mjs";
import { Response } from "./response.mjs";
import { ReturnedResponse } from "./types.mjs";
import { RequestControllerContract } from "../router/types.mjs";

//#region ../../@warlock.js/core/src/http/request-controller.d.ts
declare abstract class RequestController implements RequestControllerContract {
  readonly request: Request;
  readonly response: Response;
  constructor(request: Request, response: Response);
  abstract execute(): Promise<ReturnedResponse>;
}
//#endregion
export { RequestController };
//# sourceMappingURL=request-controller.d.mts.map