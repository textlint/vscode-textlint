interface TextLintFixCommand {
  text: string;
  range: [number, number];
  isAbsolute: boolean;
}

interface TextLintMessage {
  // See src/shared/type/MessageType.js
  // Message Type
  type: string;
  // Rule Id
  ruleId: string;
  message: string;
  // optional data
  data?: unknown;
  // FixCommand
  fix?: TextLintFixCommand;
  // location info
  // Text -> AST TxtNode(0-based columns) -> textlint -> TextLintMessage(**1-based columns**)
  line: number; // start with 1
  column: number; // start with 1
  // indexed-location
  index: number; // start with 0
  // Severity Level
  // See src/shared/type/SeverityLevel.js
  severity?: number;
}
export interface TextlintFixResult {
  filePath: string;
  // fixed content
  output: string;
  // all messages = pre-applyingMessages + remainingMessages
  // it is same with one of `TextlintResult`
  messages: TextLintMessage[];
  // applied fixable messages
  applyingMessages: TextLintMessage[];
  // original means original for applyingMessages and remainingMessages
  // pre-applyingMessages + remainingMessages
  remainingMessages: TextLintMessage[];
}

interface TextLintResult {
  filePath: string;
  messages: TextLintMessage[];
}

type ScanFilePathResult =
  | {
      status: "ok";
    }
  | {
      status: "ignored";
    }
  | {
      status: "error";
    };

interface TextLintEngine {
  availableExtensions: string[];

  executeOnText(text: string, ext: string): Thenable<TextLintResult[]>;
}
type TextlintKernelDescriptor = {
  findPluginDescriptorWithExt(ext: string): TextlintPluginDescriptor | undefined;
};
type TextlintPluginDescriptor = {
  processor: TextlintPluginProcessor;
};
type TextlintPluginProcessor = {
  processor(extension: string): {
    preProcess(
      text: string,
      filePath?: string
    ): TextlintPluginPreProcessResult | Promise<TextlintPluginPreProcessResult>;
  };
};
type TextlintPluginPreProcessResult = TxtDocumentNode | { text: string; ast: TxtDocumentNode };
export type CreateLinterOptions = {
  descriptor: TextlintKernelDescriptor;
  ignoreFilePath?: string;
  quiet?: boolean;
  cache?: boolean;
  cacheLocation?: string;
};
export type createLinter = (options: CreateLinterOptions) => {
  lintFiles(files: string[]): Promise<TextLintResult[]>;
  lintText(text: string, filePath: string): Promise<TextLintResult>;
  fixFiles(files: string[]): Promise<TextlintFixResult[]>;
  fixText(text: string, filePath: string): Promise<TextlintFixResult>;
  scanFilePath?(filePath: string): Promise<ScanFilePathResult>;
};

// AST node types
/**
 * ASTNodeTypes is a list of ASTNode type.
 */
declare enum ASTNodeTypes {
  Document = "Document",
  DocumentExit = "Document:exit",
  Paragraph = "Paragraph",
  ParagraphExit = "Paragraph:exit",
  BlockQuote = "BlockQuote",
  BlockQuoteExit = "BlockQuote:exit",
  ListItem = "ListItem",
  ListItemExit = "ListItem:exit",
  List = "List",
  ListExit = "List:exit",
  Header = "Header",
  HeaderExit = "Header:exit",
  CodeBlock = "CodeBlock",
  CodeBlockExit = "CodeBlock:exit",
  /**
   * @deprecated use Html instead of it
   */
  HtmlBlock = "HtmlBlock",
  HtmlBlockExit = "HtmlBlock:exit",
  HorizontalRule = "HorizontalRule",
  HorizontalRuleExit = "HorizontalRule:exit",
  Comment = "Comment",
  CommentExit = "Comment:exit",
  /**
   * @deprecated
   */
  ReferenceDef = "ReferenceDef",
  /**
   * @deprecated
   */
  ReferenceDefExit = "ReferenceDef:exit",
  Str = "Str",
  StrExit = "Str:exit",
  Break = "Break", // well-known Hard Break
  BreakExit = "Break:exit", // well-known Hard Break
  Emphasis = "Emphasis",
  EmphasisExit = "Emphasis:exit",
  Strong = "Strong",
  StrongExit = "Strong:exit",
  Html = "Html",
  HtmlExit = "Html:exit",
  Link = "Link",
  LinkExit = "Link:exit",
  Image = "Image",
  ImageExit = "Image:exit",
  Code = "Code",
  CodeExit = "Code:exit",
  Delete = "Delete",
  DeleteExit = "Delete:exit",
  Table = "Table",
  TableExit = "Table:exit",
  TableRow = "TableRow",
  TableRowExit = "TableRow:exit",
  TableCell = "TableCell",
  TableCellExit = "TableCell:exit",
}
/**
 * Key of ASTNodeTypes or any string
 * For example, TxtNodeType is "Document".
 */
type TxtNodeType = keyof typeof ASTNodeTypes;
/**
 * Any TxtNode types
 */
export type AnyTxtNode = TxtNode | TxtTextNode | TxtParentNode;
/**
 * Position's line start with 1.
 * Position's column start with 0.
 * This is for compatibility with JavaScript AST.
 * https://gist.github.com/azu/8866b2cb9b7a933e01fe
 */
type TxtNodePosition = {
  line: number;
  column: number;
};
/**
 * Location
 */
type TxtNodeLocation = {
  start: TxtNodePosition;
  end: TxtNodePosition;
};
/**
 * Range starts with 0
 */
type TxtNodeRange = readonly [startIndex: number, endIndex: number];
/**
 * TxtNode is abstract interface of AST Node.
 * Probably, Real TxtNode implementation has more properties.
 */
interface TxtNode {
  type: TxtNodeType;
  raw: string;
  range: TxtNodeRange;
  loc: TxtNodeLocation;
  parent?: TxtParentNode;
}
/**
 * Text Node.
 * Text Node has inline value.
 * For example, `Str` Node is an TxtTextNode.
 */
interface TxtTextNode extends TxtNode {
  value: string;
}
/**
 * Parent Node.
 * Parent Node has children that are consist of TxtParentNode or TxtTextNode
 */
interface TxtParentNode extends TxtNode {
  children: Content[];
}
type AlignType = "left" | "right" | "center" | null;
type ReferenceType = "shortcut" | "collapsed" | "full";
type Content = TopLevelContent | ListContent | TableContent | RowContent | PhrasingContent;
/**
 * All node definition types.
 */
type TopLevelContent = BlockContent;
/**
 * All node types that may be used where markdown block content is accepted.
 * These types are accepted inside block quotes, list items, and roots.
 */
type BlockContent =
  | TxtParagraphNode
  | TxtHeaderNode
  | TxtHorizontalRuleNode
  | TxtBlockQuoteNode
  | TxtListNode
  | TxtTableNode
  | TxtHtmlNode
  | TxtCodeBlockNode;
/**
 * All node types that are acceptable inside lists.
 */
type ListContent = TxtListItemNode;
/**
 * All node types that are acceptable inside tables (not table cells).
 */
type TableContent = TxtTableRowNode;
/**
 * All node types that are acceptable inside tables rows (not table cells)
 */
type RowContent = TxtTableCellNode;
/**
 * All node types that are acceptable in a (interactive) phrasing context (so not in links).
 */
type PhrasingContent = TxtLinkNode | StaticPhrasingContent;
/**
 * All node types that are acceptable in a static phrasing context.
 */
type StaticPhrasingContent =
  | TxtStrNode
  | TxtEmphasisNode
  | TxtStrongNode
  | TxtDeleteNode
  | TxtHtmlNode
  | TxtCodeNode
  | TxtBreakNode
  | TxtImageNode
  | TxtCommentNode;
interface TxtDocumentNode extends TxtParentNode {
  type: "Document";
}
interface TxtParagraphNode extends TxtParentNode {
  type: "Paragraph";
  children: PhrasingContent[];
}
interface TxtHeaderNode extends TxtParentNode {
  type: "Header";
  depth: 1 | 2 | 3 | 4 | 5 | 6;
  children: PhrasingContent[];
}
interface TxtHorizontalRuleNode extends TxtNode {
  type: "HorizontalRule";
}
interface TxtBlockQuoteNode extends TxtParentNode {
  type: "BlockQuote";
  children: BlockContent[];
}
interface TxtListNode extends TxtParentNode {
  type: "List";
  ordered?: boolean | null | undefined;
  start?: number | null | undefined;
  spread?: boolean | null | undefined;
  children: ListContent[];
}
interface TxtListItemNode extends TxtParentNode {
  type: "ListItem";
  checked?: boolean | null | undefined;
  spread?: boolean | null | undefined;
  children: BlockContent[];
}
interface TxtTableNode extends TxtParentNode {
  type: "Table";
  align?: AlignType[] | null | undefined;
  children: TableContent[];
}
interface TxtTableRowNode extends TxtParentNode {
  type: "TableRow";
  children: RowContent[];
}
interface TxtTableCellNode extends TxtParentNode {
  type: "TableCell";
  children: PhrasingContent[];
}
interface TxtHtmlNode extends TxtTextNode {
  type: "Html";
}
interface TxtCommentNode extends TxtTextNode {
  type: "Comment";
}
interface TxtCodeBlockNode extends TxtTextNode {
  type: "CodeBlock";
  lang?: string | null | undefined;
  meta?: string | null | undefined;
}
interface TxtStrNode extends TxtTextNode {
  type: "Str";
}
interface TxtEmphasisNode extends TxtParentNode {
  type: "Emphasis";
  children: PhrasingContent[];
}
interface TxtStrongNode extends TxtParentNode {
  type: "Strong";
  children: PhrasingContent[];
}
interface TxtDeleteNode extends TxtParentNode {
  type: "Delete";
  children: PhrasingContent[];
}
interface TxtCodeNode extends TxtTextNode {
  type: "Code";
}
interface TxtBreakNode extends TxtNode {
  type: "Break";
}
interface TxtLinkNode extends TxtParentNode, TxtResource {
  type: "Link";
  children: StaticPhrasingContent[];
}
interface TxtImageNode extends TxtNode, TxtResource, TxtAlternative {
  type: "Image";
}
interface TxtResource {
  url: string;
  title?: string | null | undefined;
}
interface TxtAlternative {
  alt?: string | null | undefined;
}
