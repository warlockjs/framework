import { environment } from "@warlock.js/core";
import { groupedTranslations } from "@mongez/localization";
import type { PageConfig, PageLoaderContext } from "@warlock.js/web";

/** Development only: a production build answers "not found" so the page is never public. */
export async function loader({ response }: PageLoaderContext<undefined, undefined>) {
  if (environment() !== "development") return response.notFound();

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
