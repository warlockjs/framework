/** Loads the design-system page for development and end-to-end runs only. */
import { groupedTranslations } from "@mongez/localization";
import { environment } from "@warlock.js/core";
import type { PageConfig, PageLoaderContext } from "@warlock.js/web";

/**
 * Development and end-to-end runs (`WARLOCK_E2E=1`, set by `warlock e2e`) only: any
 * other production build answers "not found" so the page is never public.
 */
export async function loader({ response }: PageLoaderContext<undefined, undefined>) {
  if (environment() !== "development" && process.env.WARLOCK_E2E !== "1") {
    return response.notFound();
  }

  return {};
}

export const config = {
  route: { path: "/dev/components", name: "dev-components" },
  metadata: { title: "Components", robots: "noindex" },
} satisfies PageConfig<typeof loader>;

export function register() {
  groupedTranslations({
    components: {
      title: { en: "Components", ar: "المكونات" },
      headings: { en: "Headings", ar: "العناوين" },
      controls: { en: "Form controls", ar: "عناصر النموذج" },
      name: { en: "Name", ar: "الاسم" },
      email: { en: "Email", ar: "البريد الإلكتروني" },
      message: { en: "Message", ar: "الرسالة" },
      send: { en: "Send request", ar: "إرسال الطلب" },
      error: {
        en: "Enter a valid email address, like ada@example.com.",
        ar: "أدخل بريدًا إلكترونيًا صالحًا، مثل ada@example.com.",
      },
    },
  });
}
