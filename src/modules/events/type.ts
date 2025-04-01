declare const __tag: unique symbol;

export type TaggedType<T, U extends string> = T & { [__tag]: U };
export type FilePath = TaggedType<string, 'FilePath'>;
export type FilePathWithPrefixLC = TaggedType<string, 'FilePathWithPrefixLC'>;
export type FilePathWithPrefix =
  | TaggedType<string, 'FilePathWithPrefix'>
  | FilePath
  | FilePathWithPrefixLC;
export type DocumentID = TaggedType<string, 'documentId'>;

export type UXFileInfo = UXFileInfoStub & {
  body: Blob;
};
// export type UXFileInfoStub = UXFileFileInfoStub;
export type UXAbstractInfoStub = UXFileInfoStub | UXFolderInfo;

export type UXFileInfoStub = {
  name: string;
  path: FilePath | FilePathWithPrefix;
  stat: UXStat;
  deleted?: boolean;
  isFolder?: false;
  isInternal?: boolean;
};

export type UXStat = {
  size: number;
  mtime: number;
  ctime: number;
  type: 'file' | 'folder';
};

export type UXFolderInfo = {
  name: string;
  path: FilePath | FilePathWithPrefix;
  deleted?: boolean;
  isFolder: true;
  children: UXFileInfoStub[];
  parent: FilePath | FilePathWithPrefix | undefined;
};
