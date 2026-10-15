import { Model } from "@warlock.js/cascade";
import { FixtureUserResource } from "../resources/fixture-user.resource";

export type FixtureUserData = {
  id: number;
  name: string;
  password: string;
  createdAt: Date;
};

export class FixtureUser extends Model<FixtureUserData> {
  public static resource = FixtureUserResource;
}
