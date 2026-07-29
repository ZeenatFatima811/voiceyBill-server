import { Controller, Get, HttpCode, Inject, Query, Res } from "@nestjs/common";
import { type Response } from "express";

import { Env } from "../../config/env.config";
import { HTTPSTATUS } from "../../config/http.config";
import {
  CURRENCY_METADATA,
  isValidCurrencyCode,
} from "../../utils/currency.constants";

import { CurrencyService } from "./currency.service";

@Controller(`${Env.BASE_PATH}/currency`)
export class CurrencyController {
  constructor(
    @Inject(CurrencyService)
    private readonly currencyService: CurrencyService,
  ) {}

  @Get("supported")
  @HttpCode(HTTPSTATUS.OK)
  async getSupportedCurrencies() {
    const currencies = await this.currencyService.getSupportedCurrencies();

    const enriched = Object.entries(currencies).map(([code, name]) => ({
      code,
      name,
      symbol: CURRENCY_METADATA[code]?.symbol || code,
    }));

    return {
      message: "Supported currencies fetched successfully",
      currencies: enriched,
    };
  }

  /**
   * `@Res({ passthrough: true })` is used only to set the 400 status on the
   * invalid-code branch. Throwing `BadRequestException` instead would add an
   * `errorCode` field the previous response did not have.
   */
  @Get("rate")
  @HttpCode(HTTPSTATUS.OK)
  async getExchangeRate(
    @Query() query: Record<string, unknown>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const from = ((query.from as string) || "USD").toUpperCase();
    const to = ((query.to as string) || "EUR").toUpperCase();
    if (!isValidCurrencyCode(from) || !isValidCurrencyCode(to)) {
      res.status(HTTPSTATUS.BAD_REQUEST);
      return {
        message:
          "Invalid currency code. Please provide a supported ISO 4217 currency code.",
      };
    }
    const result = await this.currencyService.getRate(from, to);

    return {
      message: "Exchange rate fetched successfully",
      data: {
        from,
        to,
        rate: result.rate,
        source: result.source,
        rateDate: result.rateDate,
      },
    };
  }
}
