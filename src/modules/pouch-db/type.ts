export interface PouchDbOptions {
  name: string;
  prefix: string;
}

export type PouchDbOptionParams = Partial<PouchDbOptions>;

export type Post = {
  content: string;
  meta?: string;
  tag?: string[];
  createdAt: Date;
  updatedAt: Date;
};
