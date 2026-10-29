import { Center, Pagination, Stack, Table, Text } from "@mantine/core";
import type { ReactNode } from "react";

/** The `pagination` block of a Warlock paginated API response (`listEndpoint`, `paginate()`). */
export type PaginationInfo = { page: number; pages: number; total?: number; limit?: number };

export type PaginatedColumn<Row> = {
  /** A stable key for the column. */
  key: string;
  header: ReactNode;
  /** Render a cell; defaults to the row's `key` property as text. */
  render?: (row: Row, index: number) => ReactNode;
  align?: "start" | "center" | "end";
};

export type PaginatedTableProps<Row> = {
  columns: readonly PaginatedColumn<Row>[];
  rows: readonly Row[];
  pagination: PaginationInfo;
  onPageChange: (page: number) => void;
  /** Reads a stable row key; defaults to the row's `id`, then its index. */
  rowKey?: (row: Row, index: number) => string | number;
  loading?: boolean;
  emptyLabel?: ReactNode;
  caption?: ReactNode;
};

function defaultKey(row: unknown, index: number): string | number {
  const id = (row as { id?: unknown } | null)?.id;
  return typeof id === "string" || typeof id === "number" ? id : index;
}

/**
 * A Mantine `Table` with `Pagination`, driven by the response shape of a
 * Warlock list endpoint: pass its items as `rows` and its `pagination` block
 * as-is, then load the requested page in `onPageChange`.
 */
export default function PaginatedTable<Row>({
  columns,
  rows,
  pagination,
  onPageChange,
  rowKey = defaultKey,
  loading = false,
  emptyLabel = "Nothing to show",
  caption,
}: PaginatedTableProps<Row>) {
  return (
    <Stack gap="md" aria-busy={loading}>
      <Table.ScrollContainer minWidth={480}>
        <Table striped highlightOnHover opacity={loading ? 0.6 : 1}>
          {caption ? <Table.Caption>{caption}</Table.Caption> : null}
          <Table.Thead>
            <Table.Tr>
              {columns.map((column) => (
                <Table.Th key={column.key} ta={column.align}>
                  {column.header}
                </Table.Th>
              ))}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((row, index) => (
              <Table.Tr key={rowKey(row, index)}>
                {columns.map((column) => (
                  <Table.Td key={column.key} ta={column.align}>
                    {column.render
                      ? column.render(row, index)
                      : String((row as Record<string, unknown>)[column.key] ?? "")}
                  </Table.Td>
                ))}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      {rows.length === 0 ? (
        <Text role="status" c="dimmed" ta="center">
          {emptyLabel}
        </Text>
      ) : null}
      {pagination.pages > 1 ? (
        <Center>
          <Pagination
            total={pagination.pages}
            value={pagination.page}
            onChange={onPageChange}
            disabled={loading}
          />
        </Center>
      ) : null}
    </Stack>
  );
}
