import { Injectable } from "@nestjs/common";

import { exchangeRateService } from "../../services/exchange-rate.service";

/** Injectable seam over the existing `exchangeRateService` singleton. */
@Injectable()
export class CurrencyService {
  getSupportedCurrencies() {
    return exchangeRateService.getSupportedCurrencies();
  }

  getRate(from: string, to: string) {
    return exchangeRateService.getRate(from, to);
  }
}
