import axios from "axios";

import { currency as currencyRepo, withTransaction } from "../../db/repositories";
export const updateSupportedCurrenciesCache = async () => {
  try {
    const providerUrl = process.env.EXCHANGE_RATE_PROVIDER_URL;
    const timeout = Number(process.env.EXCHANGE_RATE_TIMEOUT_MS);

    console.log(`Starting background currencies cache update from: ${providerUrl}/currencies`);
    const response = await axios.get(`${providerUrl}/currencies`, { timeout });
    const currencies: Array<{ iso_code: string; name: string }> = response.data;

    if (currencies && currencies.length > 0) {
      // Clear and bulk insert fresh currency definitions
      // Delete-then-insert in ONE transaction. The Mongo version issued the
      // two statements separately, so a failure between them left the cache
      // empty and every currency lookup falling back to the hardcoded list.
      // The executor has to be threaded in for that to be true — without it
      // the DELETE autocommits on its own connection and the window is still
      // open.
      const docs = currencies.map((c) => ({
        code: c.iso_code,
        name: c.name,
      }));
      await withTransaction((tx) => currencyRepo.replaceSupported(docs, tx));
      console.log(`⏰ Successfully cached ${docs.length} supported currencies`);
      return { success: true, count: docs.length };
    }
    
    console.warn("Currencies response from provider was empty or invalid");
    return { success: false, error: "Empty currencies list" };
  } catch (error: any) {
    console.warn("Failed to update currency cache in cron job, preserving current cache:", error.message);
    return { success: false, error: error.message };
  }
};

export const updateExchangeRatesCache = async () => {
  const PROVIDER_BASE_URL=process.env.EXCHANGE_RATE_PROVIDER_URL
  const TIMEOUT=Number(process.env.EXCHANGE_RATE_TIMEOUT_MS)
  try {
    console.log(`Starting exchange rates cache update...`);
    const response = await axios.get(`${PROVIDER_BASE_URL}/rates`, {
      params: { base: "USD" },
      timeout: TIMEOUT,
    });

    const rates: Array<{ quote: string; rate: number; date: string }> = response.data;

    if (!rates?.length) {
      console.warn("Exchange rates response was empty");
      return { success: false, error: "Empty rates list" };
    }

    /**
     * `bulkWrite` of upserts becomes one multi-row ON CONFLICT — which is why
     * exchange_rate_cache carries a unique index on the currency pair.
     *
     * One deliberate behaviour difference: Mongo accumulated a row per fetch,
     * whereas this keeps one row per pair. Nothing reads the history — every
     * lookup is "freshest rate for this pair", bounded by MAX_CACHE_AGE_MS — but
     * the history stops growing.
     */
    const fetchedAt = new Date();
    await currencyRepo.upsertRates(
      rates.map((r) => ({
        fromCurrency: "USD",
        toCurrency: r.quote,
        rate: r.rate,
        rateDate: r.date,
        fetchedAt,
      })),
    );
    console.log(`✅ Cached ${rates.length} exchange rates`);
    return { success: true, count: rates.length };
  } catch (error: any) {
    console.warn("Failed to update exchange rates cache:", error.message);
    return { success: false, error: error.message };
  }
};
