/** Loads users from the repository for the controllers. */
import { usersRepository } from "../repositories/users.repository";

export async function getUsersService() {
  return usersRepository.allActiveCached();
}
