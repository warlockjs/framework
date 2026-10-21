import { type GuardedRequestHandler } from "app/auth/requests/guarded.request";
import { UserResource } from "app/users/resources/user.resource";
import { User } from "../models/user";
import { createUserSchema, type CreateUserSchema } from "../schema/create-user.schema";

export const createNewUserController: GuardedRequestHandler<CreateUserSchema> = async ({
  request,
  response,
}) => {
  const file = request.file("image");

  if (!file) {
    return response.badRequest({ error: { code: "imageRequired", message: "Image is required." } });
  }

  const output = await file.save("images");

  const user = await User.create({
    ...request.validated(["name", "email", "password"]),
    image: output.path,
    imageMetadata: await file.metadata(),
  });

  return response.successCreate({
    message: "File uploaded successfully",
    user,
  });
};

createNewUserController.validation = {
  schema: createUserSchema,
};

createNewUserController.responseSchema = {
  201: { body: { message: "string", user: UserResource } },
  422: { body: { error: { code: "string", message: "string" }, requestId: "string" } },
  500: { body: { error: { code: "string", message: "string" }, requestId: "string" } },
  400: { body: { error: { code: "string", message: "string" }, requestId: "string" } },
};
