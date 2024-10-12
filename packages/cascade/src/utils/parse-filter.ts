import { Aggregate, type WhereOperator } from "./../aggregate";
import { type ModelAggregate } from "./../model";

export type FilterOptionType =
  | "bool"
  | "boolean"
  | "number"
  | "inNumber"
  | "null"
  | "notNull"
  | "!null"
  | "int"
  | "int>"
  | "int>="
  | "int<"
  | "int<="
  | "in"
  | "!int"
  | "integer"
  | "inInt"
  | "float"
  | "double"
  | "inFloat"
  | "date"
  | "inDate"
  | "date>"
  | "date>="
  | "date<"
  | "date<="
  | "dateBetween"
  | "dateTime"
  | "inDateTime"
  | "dateTime>"
  | "dateTime>="
  | "dateTime<"
  | "dateTime<="
  | "dateTimeBetween"
  | "location"
  | WhereOperator;

export type FilterByType =
  | FilterOptionType
  | ((value: any, query: ModelAggregate<any>) => any)
  | [FilterOptionType]
  | [FilterOptionType, string | string[]];

export type FilterByOptions = {
  [key: string]: FilterByType;
};

const filterMap = {};

function prepareFilter(filterStructure: FilterByOptions) {
  const filter = {};
  for (const key in filterStructure) {
    const value = filterStructure[key];

    if (typeof value === "string") {
      //
    }
  }
  return filter;
}

export function parseFilterBy(filterStructure: FilterByOptions) {
  const filter = prepareFilter(filterStructure);
  return {
    filter: (query: Aggregate, data: any) => {
      //
    },
  };
}
