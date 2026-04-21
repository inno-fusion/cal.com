// Razorpay's supported international currencies minus RUB (excluded due to sanctions risk).
// Exactly 40 currencies per spec §5 / §15.
export const currencyOptions = [
  { label: "Indian rupee (INR)", value: "inr" },
  { label: "United States dollar (USD)", value: "usd" },
  { label: "United Arab Emirates dirham (AED)", value: "aed" },
  { label: "Australian dollar (AUD)", value: "aud" },
  { label: "Bangladeshi taka (BDT)", value: "bdt" },
  { label: "Brazilian real (BRL)", value: "brl" },
  { label: "Canadian dollar (CAD)", value: "cad" },
  { label: "Swiss franc (CHF)", value: "chf" },
  { label: "Chinese yuan (CNY)", value: "cny" },
  { label: "Czech koruna (CZK)", value: "czk" },
  { label: "Danish krone (DKK)", value: "dkk" },
  { label: "Euro (EUR)", value: "eur" },
  { label: "British pound sterling (GBP)", value: "gbp" },
  { label: "Hong Kong dollar (HKD)", value: "hkd" },
  { label: "Hungarian forint (HUF)", value: "huf" },
  { label: "Indonesian rupiah (IDR)", value: "idr" },
  { label: "Israeli new shekel (ILS)", value: "ils" },
  { label: "Japanese yen (JPY)", value: "jpy" },
  { label: "Kenyan shilling (KES)", value: "kes" },
  { label: "South Korean won (KRW)", value: "krw" },
  { label: "Sri Lankan rupee (LKR)", value: "lkr" },
  { label: "Moroccan dirham (MAD)", value: "mad" },
  { label: "Mexican peso (MXN)", value: "mxn" },
  { label: "Malaysian ringgit (MYR)", value: "myr" },
  { label: "Nigerian naira (NGN)", value: "ngn" },
  { label: "Norwegian krone (NOK)", value: "nok" },
  { label: "Nepalese rupee (NPR)", value: "npr" },
  { label: "New Zealand dollar (NZD)", value: "nzd" },
  { label: "Philippine peso (PHP)", value: "php" },
  { label: "Pakistani rupee (PKR)", value: "pkr" },
  { label: "Polish złoty (PLN)", value: "pln" },
  { label: "Qatari riyal (QAR)", value: "qar" },
  { label: "Saudi riyal (SAR)", value: "sar" },
  { label: "Swedish krona (SEK)", value: "sek" },
  { label: "Singapore dollar (SGD)", value: "sgd" },
  { label: "Thai baht (THB)", value: "thb" },
  { label: "Turkish lira (TRY)", value: "try" },
  { label: "New Taiwan dollar (TWD)", value: "twd" },
  { label: "Ukrainian hryvnia (UAH)", value: "uah" },
  { label: "Vietnamese đồng (VND)", value: "vnd" },
] as const;

// Payment options — HOLD is out of scope for v1; only ON_BOOKING is supported.
export const paymentOptions = [
  {
    label: "on_booking_option",
    value: "ON_BOOKING" as const,
  },
];

export const SUPPORTED_CURRENCIES = currencyOptions.map((c) => c.value);

export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

export function isSupportedCurrency(currency: string): currency is SupportedCurrency {
  return SUPPORTED_CURRENCIES.includes(currency.toLowerCase() as SupportedCurrency);
}

export function getCurrencyLabel(currency: string): string {
  const found = currencyOptions.find((c) => c.value === currency.toLowerCase());
  return found?.label ?? currency.toLowerCase();
}
