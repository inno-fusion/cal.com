import AppNotInstalledMessage from "@calcom/app-store/_components/AppNotInstalledMessage";
import { currencyOptions } from "@calcom/app-store/razorpay/lib/constants";
import type { IRazorpaySetupProps } from "@calcom/app-store/razorpay/pages/setup/_getServerSideProps";
import { WEBAPP_URL } from "@calcom/lib/constants";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { trpc } from "@calcom/trpc/react";
import { Alert } from "@calcom/ui/components/alert";
import { Button } from "@calcom/ui/components/button";
import { Select, TextField } from "@calcom/ui/components/form";
import { showToast } from "@calcom/ui/components/toast";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { Toaster } from "sonner";
import { z } from "zod";

type CurrencyOption = { value: string; label: string };

const settingsSchema = z.object({
  key_id: z.string().min(1),
  key_secret: z.string().min(1),
  webhook_secret: z.string().optional(),
  default_currency: z.string().min(1),
});

type FormValues = z.infer<typeof settingsSchema>;

export default function RazorpaySetup(props: IRazorpaySetupProps) {
  const { t, i18n } = useLocale();
  const router = useRouter();
  const session = useSession();
  const [loading, setLoading] = useState(false);

  const integrations = trpc.viewer.apps.integrations.useQuery({ variant: "payment", appId: "razorpay" });
  const [razorpayCredential] = integrations.data?.items || [];
  const [credentialId] = razorpayCredential?.userCredentialIds || [-1];
  const showContent = !!integrations.data && integrations.isSuccess && !!credentialId;

  const saveKeysMutation = trpc.viewer.apps.updateAppCredentials.useMutation({
    onSuccess: () => {
      showToast(t("keys_have_been_saved"), "success");
      router.push("/event-types");
    },
    onError: (error) => {
      showToast(error.message, "error");
    },
  });

  const i18nCurrencyOptions: CurrencyOption[] = currencyOptions.map((opt) => {
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

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      key_id: props.keyId || "",
      key_secret: "",
      webhook_secret: "",
      default_currency: props.defaultCurrency || "inr",
    },
  });

  useEffect(() => {
    reset({
      key_id: props.keyId || "",
      key_secret: "",
      webhook_secret: "",
      default_currency: props.defaultCurrency || "inr",
    });
  }, [props, reset]);

  const onSubmit = handleSubmit(async (data) => {
    if (loading) return;
    setLoading(true);
    try {
      saveKeysMutation.mutate({
        credentialId,
        key: {
          key_id: data.key_id,
          key_secret: data.key_secret,
          ...(data.webhook_secret ? { webhook_secret: data.webhook_secret } : {}),
          default_currency: data.default_currency,
        },
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "";
      showToast(message, "error");
    } finally {
      setLoading(false);
    }
  });

  const webhookUrl = `${WEBAPP_URL}/api/integrations/razorpay/webhook`;

  if (session.status === "loading") return <></>;

  if (integrations.isPending) {
    return <div className="absolute z-50 flex h-screen w-full items-center bg-gray-200" />;
  }

  return (
    <>
      <div className="bg-default flex h-screen items-center justify-center">
        {showContent ? (
          <div className="flex w-full max-w-[43em] flex-col items-center justify-center stack-y-4 p-4 lg:stack-y-5">
            <Alert
              severity="warning"
              title={t("razorpay_international_payments_warning")}
              className="w-full"
            />

            <form className="w-full stack-y-4" onSubmit={onSubmit}>
              <div className="bg-default border-subtle overflow-auto rounded border">
                <div className="border-subtle flex items-center justify-between border-b p-4 md:p-5">
                  <h2 className="text-2xl font-semibold">{t("razorpay")}</h2>
                </div>
                <div className="w-full stack-y-4 p-4 md:p-5">
                  <TextField
                    {...register("key_id")}
                    id="key_id"
                    label={t("razorpay_setup_key_id")}
                    placeholder="rzp_live_xxxxxxxxxxxxx"
                    autoComplete="off"
                    autoCorrect="off"
                    required
                  />
                  {errors.key_id && <p className="py-2 text-xs text-red-500">{errors.key_id.message}</p>}

                  <TextField
                    {...register("key_secret")}
                    id="key_secret"
                    label={t("razorpay_setup_key_secret")}
                    type="password"
                    autoComplete="new-password"
                    required
                  />
                  {errors.key_secret && (
                    <p className="py-2 text-xs text-red-500">{errors.key_secret.message}</p>
                  )}

                  <TextField
                    {...register("webhook_secret")}
                    id="webhook_secret"
                    label={t("razorpay_webhook_secret_optional")}
                    type="password"
                    autoComplete="new-password"
                  />

                  <div>
                    <label className="text-default mb-1 block text-sm font-medium" htmlFor="default_currency">
                      {t("razorpay_default_currency_required")}
                    </label>
                    <Controller
                      name="default_currency"
                      control={control}
                      render={({ field }) => (
                        <Select<CurrencyOption>
                          options={i18nCurrencyOptions}
                          value={
                            i18nCurrencyOptions.find((opt) => opt.value === field.value) ||
                            i18nCurrencyOptions[0]
                          }
                          onChange={(e) => {
                            if (e) field.onChange(e.value);
                          }}
                          className="text-black"
                        />
                      )}
                    />
                    {errors.default_currency && (
                      <p className="py-2 text-xs text-red-500">{errors.default_currency.message}</p>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-4">
                <Button className="h-10" color="primary" type="submit" disabled={loading}>
                  {loading ? t("saving") : t("save")}
                </Button>
              </div>
            </form>

            <div className="bg-default border-subtle w-full overflow-auto rounded border p-4 md:p-5">
              <h3 className="mb-3 text-lg font-semibold">{t("razorpay_setup_instructions_header")}</h3>
              <ol className="list-decimal space-y-2 pl-5 text-sm">
                <li>{t("razorpay_setup_step_login")}</li>
                <li>{t("razorpay_setup_step_api_keys")}</li>
                <li>{t("razorpay_setup_step_generate_keys")}</li>
                <li>
                  {t("razorpay_setup_step_webhook")}{" "}
                  <code className="bg-subtle rounded px-1 py-0.5 text-xs">{webhookUrl}</code>
                </li>
                <li>
                  {t("razorpay_setup_step_events")}{" "}
                  <code className="bg-subtle rounded px-1 py-0.5 text-xs">
                    order.paid, payment.captured, payment.failed, refund.created, refund.processed,
                    refund.failed, refund.speed_changed
                  </code>
                </li>
                <li>{t("razorpay_setup_step_copy_secret")}</li>
                <li>{t("razorpay_setup_step_save")}</li>
              </ol>
              <div className="mt-4 space-y-1 text-sm">
                <p className="text-subtle">{t("razorpay_active_account_required")}</p>
                <p className="text-subtle">{t("razorpay_api_keys_required")}</p>
                <p className="text-subtle">{t("razorpay_webhook_recommended")}</p>
              </div>
            </div>
          </div>
        ) : (
          <AppNotInstalledMessage appName="razorpay" />
        )}
        <Toaster position="bottom-right" />
      </div>
    </>
  );
}
