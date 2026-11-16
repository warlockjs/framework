import { ResourceNotFoundError } from "@warlock.js/core";
import type { UsersListOptions } from "../repositories/users.repository";
import { usersRepository } from "../repositories/users.repository";

export async function listUsersService(filters: UsersListOptions = {}) {
  return usersRepository.listCached(filters);
}

export async function getFirstUserService(filters: UsersListOptions = {}) {
  const user = await usersRepository.firstCached(filters);

  if (!user) {
    throw new ResourceNotFoundError("No user found");
  }

  return user;
}
