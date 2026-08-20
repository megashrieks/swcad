import type { SerializedDocument } from '../src/core/io/serialize';
import type { AnnotationEntry, ComponentDef } from '../src/core/model/types';

export type PackageFiles = Record<string, string>;

export interface ComponentManifest {
  id: string;
  name?: string;
  version?: string;
  category?: string;
  description?: string;
  connector?: boolean;
  resizable?: boolean;
  defaultSize?: { w: number; h: number };
  params?: ComponentDef['params'];
  /** Override the conventional file names. `annotations` may also be inlined. */
  shape?: string;
  annotations?: string | Record<string, AnnotationEntry>;
  script?: string;
}

export interface ResolvedPackage {
  def: ComponentDef;
  manifest: Partial<ComponentManifest>;
  /** The drawing as a document, when the package is drawn rather than typed. */
  document: SerializedDocument | null;
  documentFile: string | null;
  shapeFile: string | null;
  annotationsFile: string | null;
  scriptFile: string | null;
  script: string | null;
  /** Fatal problems: the component cannot be drawn. */
  errors: string[];
  /** Things worth flagging to the author, such as an annotation with no element. */
  warnings: string[];
}

export const MANIFEST_FILE: string;
export const DOCUMENT_FILE: string;
export const SHAPE_FILE: string;
export const ANNOTATIONS_FILE: string;
export const SCRIPT_FILE: string;

export function readShape(text: string): { source: string; size: { w: number; h: number } | null };
export function writeShape(source: string, size?: { w: number; h: number } | null): string;
export function formatSvg(source: string, indent?: string): string;
export function formatJson(value: unknown, indent?: string, width?: number): string;
export function shapeIds(shapeText: string): Set<string>;
export function shapeElements(shapeText: string): { tag: string; id: string }[];
export function resolvePackage(files: PackageFiles, fallbackId?: string): ResolvedPackage;
export function packageFromDefinition(def: ComponentDef, script: string | null): PackageFiles;
