import type { EventTypeAppSettingsComponent } from "@calcom/app-store/types";
import {
  convertFromSmallestToPresentableCurrencyUnit,
  convertToSmallestCurrencyUnit,
} from "@calcom/lib/currencyConversions";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { RefundPolicy } from "@calcom/lib/payment/types";
import classNames from "@calcom/ui/classNames";
import { Alert } from "@calcom/ui/components/alert";
import { CheckboxField, Select, TextField } from "@calcom/ui/components/form";
import { RadioField } from "@calcom/ui/components/radio";
import * as RadioGroup from "@radix-ui/react-radio-group";
import { useEffect, useState } from "react";
import { currencyOptions } from "../lib/constants";

type Option = { value: string; label: string };

const EventTypeAppSettingsInterface: EventTypeAppSettingsComponent = ({
  getAppData,
  setAppData,
  disabled,
  eventType,
}) => {
  const price = getAppData("price");
  const currency = getAppData("currency") || currencyOptions[0].value;
  const [selectedCurrency, setSelectedCurrency] = useState<Option>(
    currencyOptions.find((c) => c.value === currency) ?? {
      label: currencyOptions[0].label,
      value: currencyOptions[0].value,
    }
  );
  const requirePayment = getAppData("enabled");
  const recurringEventDefined = eventType.recurringEvent?.count !== undefined;

  const { t, i18n } = useLocale();

  const getCurrencySymbol = (locale: string, curr: string) =>
    (0)
      .toLocaleString(locale, {
        style: "currency",
        currency: curr,
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      })
      .replace(/\d/g, "")
      .trim();

  // Build i18n'd currency option labels
  const i18nCurrencyOptions: Option[] = currencyOptions.map((opt) => {
    try {
      const displayName = new Intl.DisplayNames([i18n.language || "en"], { type: "currency" }).of(
        opt.value.toUpperCase()
      );
      return {
        value: opt.value,
        label: displayName ? `${displayName} (${opt.value.toUpperCase()})` : opt.label,
      };
    } catch {
      return { value: opt.value, label: opt.label };
    }
  });

  const getSelectedOption = () =>
    calendarDaysOptions.find((opt) => opt.value === (getAppData("refundCountCalendarDays") === true ? 1 : 0));

  useEffect(() => {
    if (requirePayment) {
      if (!getAppData("currency")) {
        setAppData("currency", currencyOptions[0].value);
      }
      // Fixed to ON_BOOKING — no selector shown
      if (!getAppData("paymentOption")) {
        setAppData("paymentOption", "ON_BOOKING");
      }
    }

    if (!getAppData("refundPolicy")) {
      setAppData("refundPolicy", RefundPolicy.NEVER);
    }
  }, [requirePayment, getAppData, setAppData]);

  const calendarDaysOptions = [
    { value: 0, label: t("business_days") },
    { value: 1, label: t("calendar_days") },
  ];

  const refundPolicyOptions: { value: RefundPolicy; label: string }[] = [
    { value: RefundPolicy.NEVER, label: t("never_refund") },
    { value: RefundPolicy.ALWAYS, label: t("always_refund_on_cancellation") },
    { value: RefundPolicy.DAYS, label: t("refund_if_cancelled_x_days_before") },
  ];

  return (
    <>
      {recurringEventDefined && (
        <Alert className="mt-2" severity="warning" title={t("warning_recurring_event_payment")} />
      )}
      {!recurringEventDefined && requirePayment && (
        <>
          <div className="mt-4 block items-center justify-start sm:flex sm:space-x-2">
            <TextField
              data-testid="razorpay-price-input"
              label={t("price")}
              className="h-[38px]"
              addOnLeading={
                <>{selectedCurrency.value ? getCurrencySymbol("en", selectedCurrency.value) : ""}</>
              }
              addOnSuffix={currency.toUpperCase()}
              addOnClassname="h-[38px]"
              step="0.01"
              min="0.5"
              type="number"
              required
              placeholder="Price"
              disabled={disabled}
              onChange={(e) => {
                setAppData("price", convertToSmallestCurrencyUnit(Number(e.target.value), currency));
              }}
              value={price > 0 ? convertFromSmallestToPresentableCurrencyUnit(price, currency) : undefined}
            />
          </div>
          <div className="mt-5 w-60">
            <label className="text-default mb-1 block text-sm font-medium" htmlFor="currency">
              {t("currency")}
            </label>
            <Select
              data-testid="razorpay-currency-select"
              variant="default"
              options={i18nCurrencyOptions}
              value={i18nCurrencyOptions.find((opt) => opt.value === currency) || i18nCurrencyOptions[0]}
              className="text-black"
              defaultValue={
                i18nCurrencyOptions.find((opt) => opt.value === currency) || i18nCurrencyOptions[0]
              }
              onChange={(e) => {
                if (e) {
                  setSelectedCurrency({ value: e.value, label: e.label });
                  setAppData("currency", e.value);
                }
              }}
            />
          </div>
          <div className="mt-4 w-full">
            <label className="text-default mb-1 block text-sm font-medium">{t("refund_policy")}</label>
            <RadioGroup.Root
              disabled={disabled}
              defaultValue={RefundPolicy.NEVER}
              className="flex flex-col stack-y-2"
              value={getAppData("refundPolicy")}
              onValueChange={(val) => {
                setAppData("refundPolicy", val as RefundPolicy);
                if (val !== RefundPolicy.DAYS) {
                  setAppData("refundDaysCount", undefined);
                  setAppData("refundCountCalendarDays", undefined);
                }
              }}>
              <RadioField
                className="w-fit"
                value={RefundPolicy.NEVER}
                label={t("never_refund")}
                id="razorpay-never"
              />
              <RadioField
                className="w-fit"
                value={RefundPolicy.ALWAYS}
                label={t("always_refund_on_cancellation")}
                id="razorpay-always"
              />
              <div className={classNames("text-default mb-2 flex flex-wrap items-center text-sm")}>
                <RadioGroup.Item
                  className="min-w-4 bg-default border-default flex h-4 w-4 cursor-pointer items-center rounded-full border focus:border-2 focus:outline-none ltr:mr-2 rtl:ml-2"
                  value={RefundPolicy.DAYS}
                  id="razorpay-days">
                  <RadioGroup.Indicator className="after:bg-inverted relative flex h-4 w-4 items-center justify-center after:block after:h-2 after:w-2 after:rounded-full" />
                </RadioGroup.Item>
                <div className="flex items-center">
                  <span className="me-2 ms-2">&nbsp;{t("if_cancelled")}</span>
                  <TextField
                    labelSrOnly
                    type="number"
                    className={classNames(
                      "border-default my-0 block w-16 text-sm [appearance:textfield] ltr:mr-2 rtl:ml-2"
                    )}
                    placeholder="2"
                    disabled={disabled}
                    min={0}
                    defaultValue={getAppData("refundDaysCount")}
                    required={getAppData("refundPolicy") === RefundPolicy.DAYS}
                    value={getAppData("refundDaysCount") ?? ""}
                    onChange={(e) => setAppData("refundDaysCount", parseInt(e.currentTarget.value))}
                  />
                  <Select
                    options={calendarDaysOptions}
                    isSearchable={false}
                    isDisabled={disabled}
                    onChange={(option) => setAppData("refundCountCalendarDays", option?.value === 1)}
                    value={getSelectedOption()}
                    defaultValue={getSelectedOption()}
                  />
                  <span className="me-2 ms-2">&nbsp;{t("before")}</span>
                </div>
              </div>
            </RadioGroup.Root>
          </div>
        </>
      )}
    </>
  );
};

export default EventTypeAppSettingsInterface;
