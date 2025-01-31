import { Uuid } from "@lambda-group/scylladb";
import type { DataSource } from "../data-source";
import { ColumnType, FilterQuery, type ColumnDefinition } from "../decorators";
import type { BaseEntityConstructor } from "../entity";
import { Logger } from "../utils/logger";

export class Repository<T> {
	private dataSource: DataSource;
	private tableName: string;
	private columns: ColumnDefinition[];
	private entityClass: BaseEntityConstructor;
	private logger: Logger = new Logger(Repository.name);

	constructor(dataSource: DataSource, entityClass: BaseEntityConstructor) {
		this.dataSource = dataSource;
		this.tableName = entityClass.prototype.tableName;
		this.columns = entityClass.columns ?? [];
		this.entityClass = entityClass;
	}

	private columnToValue(
		column: ColumnDefinition,
		row: Record<string, string | number>,
	): string | number | Date | Uuid {
		switch (column.columnType) {
			case ColumnType.TEXT:
			case ColumnType.ASCII:
				return row[column.columnName];
			case ColumnType.FLOAT:
				return row[column.columnName];
			case ColumnType.TIMESTAMP:
			case ColumnType.DATE:
				return new Date(row[column.columnName]);
			case ColumnType.UUID: {
				if (typeof row[column.columnName] !== "string")
					throw new Error("UUID must be a string");

				return row[column.columnName] as string;
				// return Uuid.fromString(row[column.columnName] as string);
			}
			default:
				return row[column.columnName];
		}
	}

	async findAll(): Promise<T[] | null> {
		const session = this.dataSource.getSession();
		const columnNames = this.columns.map((col) => col.columnName).join(", ");

		const query = `SELECT ${columnNames} FROM ${this.tableName}`;
		this.logger.log(`Executing query: ${query}`);

		return (await session.execute(query, [])).map((row: unknown) => {
			const entity = new this.entityClass();
			for (const col of this.columns) {
				// @ts-ignore: Object has no index signature
				entity[col.key] = this.columnToValue(col, row);
			}

			return entity;
		});
	}

	async findBy(props: FilterQuery<T>) {}

	async findByPartitionKey<U extends string | number | Uuid>(
		id: U,
	): Promise<T[]> {
		const session = this.dataSource.getSession();
		const columnNames = this.columns.map((col) => col.columnName).join(", ");
		const partitionKey = this.columns.find((col) => col.partitionKey);
		if (!partitionKey) {
			this.logger.error("Primary key not found");
			throw new Error("Primary key not found");
		}

		const query = `SELECT ${columnNames} FROM ${this.tableName} WHERE ${partitionKey.columnName} = ?`;
		this.logger.log(`Executing query: ${query} with values: [${id}]`);

		return (await session.execute(query, [id])).map((row: unknown) => {
			const entity = new this.entityClass();
			for (const col of this.columns) {
				// @ts-ignore: Object has no index signature
				entity[col.key] = this.columnToValue(col, row);
			}

			return entity;
		});
	}

	async save(entity: T): Promise<void> {
		const session = this.dataSource.getSession();

		const columnNames = this.columns.map((col) => col.columnName).join(", ");
		// @ts-ignore: Object has no index signature
		const values = this.columns.map((col) => entity[col.key]);
		const placeholders = this.columns.map(() => "?").join(", ");

		const query = `INSERT INTO ${this.tableName} (${columnNames}) VALUES (${placeholders})`;
		this.logger.log(`Executing query: ${query} with values: ${values}`);
		await session.execute(query, values);
	}
}
