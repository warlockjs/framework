import { type GuardedRequestHandler } from "app/auth/requests/guarded.request";
import { UserResource } from "app/users/resources/user.resource";
import { usersRepository } from "../repositories/users.repository";
import { listUsersSchema, type ListUsersSchema } from "../schema/list-users.schema";

export const listUsersController: GuardedRequestHandler<ListUsersSchema> = async ({
  request,
  response,
}) => {
  const { id, ...filters } = request.validated();
  const { data: users, pagination } = await usersRepository.listCached({
    ...filters,
    publicId: id,
  });

  return response.success({
    users,
    pagination,
  });
};

listUsersController.description = "List Users Controller";

listUsersController.validation = {
  schema: listUsersSchema,
};

listUsersController.responseSchema = {
  200: {
    body: {
      users: [UserResource],
      pagination: {
        limit: "number",
        result: "number",
        page: "number",
        total: "number",
        pages: "number",
      },
    },
  },
  422: { body: { error: { code: "string", message: "string" }, requestId: "string" } },
  500: { body: { error: { code: "string", message: "string" }, requestId: "string" } },
};
