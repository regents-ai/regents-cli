import type {
  RegentConfig,
  SiwaNonceRequest,
  SiwaNonceResponse,
  SiwaVerifyRequest,
  SiwaVerifyResponse,
} from "../../../internal-types/index.js";
import { SiwaClient } from "../../siwa/siwa.js";

export class AuthResource {
  readonly siwaClient: SiwaClient;

  constructor(baseUrl: string, requestTimeoutMs: number, config: RegentConfig) {
    this.siwaClient = new SiwaClient(baseUrl, requestTimeoutMs, config);
  }

  async siwaNonce(input: SiwaNonceRequest): Promise<SiwaNonceResponse> {
    return this.siwaClient.requestNonce(input);
  }

  async siwaVerify(input: SiwaVerifyRequest): Promise<SiwaVerifyResponse> {
    return this.siwaClient.verify(input);
  }
}
