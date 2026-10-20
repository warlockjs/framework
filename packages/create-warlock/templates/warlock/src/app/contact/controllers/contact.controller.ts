import { type Request, type RequestHandler } from "@warlock.js/core";
import { type Infer } from "@warlock.js/seal";
import { contactSchema } from "@shared/contact.schema";

export type ContactSchema = Infer.Output<typeof contactSchema>;

/** POST /api/contact — validates the starter contact form. */
export const contactController: RequestHandler<Request<ContactSchema>> = async ({
  request,
  response,
}) => {
  const contact = request.validated();

  // Replace this with delivery/persistence for your app. Keeping the accepted
  // payload visible makes the endpoint useful while remaining side-effect free.
  return response.success({
    message: "Thanks, " + contact.name + ". Your message has been received.",
  });
};

contactController.validation = { schema: contactSchema };

contactController.responseSchema = {
  200: { body: { message: "string" } },
  422: { body: { error: { code: "string", message: "string" }, requestId: "string" } },
  500: { body: { error: { code: "string", message: "string" }, requestId: "string" } },
};
