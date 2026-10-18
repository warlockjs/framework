import { type GuardedRequestHandler } from "app/auth/requests/guarded.request";
import { usersRepository } from "../repositories/users.repository";
import { listUsersSchema, type ListUsersSchema } from "../schema/list-users.schema";

export const listUsersController: GuardedRequestHandler<ListUsersSchema> = async ({
  request,
  response,
}) => {
  const users = await usersRepository.listCached(request.validated());

  return response.success({
    users,
  });
};

listUsersController.description = "List Users Controller";

listUsersController.validation = {
  schema: listUsersSchema,
};
