import type { JSONContent } from "@carbon/react";
import { StyleSheet, Text, View } from "@react-pdf/renderer";

const convertTiptapJSON = (
  node: JSONContent,
  args?: {
    index?: number;
    parentNodeType?: string;
    title?: string;
  }
) => {
  switch (node.type) {
    case "doc":
      return (
        <View style={{ fontSize: 9, width: "100%" }}>
          {args?.title && (
            <View style={styles.thead}>
              <Text>{args?.title}</Text>
            </View>
          )}
          {node?.content?.map((child, index) => convertTiptapJSON(child))}
        </View>
      );

    case "heading":
      return (
        <Text
          key={`heading-${node.attrs?.level}`}
          style={{
            fontSize: 13,
            fontWeight: "bold",
            marginBottom: 10,
            width: "100%"
          }}
        >
          {node?.content?.map((child) => convertTiptapJSON(child))}
        </Text>
      );

    case "paragraph":
      return (
        <Text
          key="paragraph"
          style={{
            fontSize: 9,
            marginBottom: 10,
            width: "100%"
          }}
        >
          {node.content?.map((child) => convertTiptapJSON(child)) || ""}
        </Text>
      );

    case "bulletList":
      return (
        <View key="bulletList" style={{ marginLeft: 20 }}>
          {node?.content?.map((child, index) =>
            convertTiptapJSON(child, {
              index,
              parentNodeType: "bulletList"
            })
          )}
        </View>
      );

    case "orderedList":
      return (
        <View key="orderedList" style={{ marginLeft: 20 }}>
          {node?.content?.map((child, index) =>
            convertTiptapJSON(child, {
              index,
              parentNodeType: "orderedList"
            })
          )}
        </View>
      );

    case "listItem":
      const indicator =
        args?.parentNodeType == "orderedList"
          ? `${(args?.index ?? 0) + 1}.`
          : "•";
      return (
        <View
          key={`listItem-${args?.index}`}
          style={{ flexDirection: "row", marginBottom: 5 }}
        >
          <Text style={{ fontSize: 9, marginRight: 5 }}> {indicator} </Text>
          <View style={{ flex: 1, minWidth: 0 }}>
            {node?.content?.map((child, index) => convertTiptapJSON(child))}
          </View>
        </View>
      );

    case "taskList":
      return (
        <View key="taskList" style={{ marginLeft: 20 }}>
          {node?.content?.map((child, index) =>
            convertTiptapJSON(child, { index })
          )}
        </View>
      );

    case "taskItem":
      return (
        <View
          key={`taskItem-${args?.index}`}
          style={{ flexDirection: "row", marginBottom: 5 }}
        >
          <Text style={{ fontSize: 9, marginRight: 5 }}>•</Text>
          <View style={{ flex: 1, minWidth: 0 }}>
            {node?.content?.map((child, index) => convertTiptapJSON(child))}
          </View>
        </View>
      );

    case "text":
      return node.text;

    case "image":
      return null;

    default:
      return null;
  }
};

const Note = ({ title, content }: { title?: string; content: JSONContent }) => {
  if (!content) return null;
  if (typeof content !== "object") return null;
  if (!("content" in content)) return null;
  if (!Array.isArray(content.content) || content.content.length === 0)
    return null;

  return (
    <View style={{ width: "100%" }}>
      {convertTiptapJSON(content, { title })}
    </View>
  );
};

export default Note;

const styles = StyleSheet.create({
  tfoot: {
    alignItems: "center",
    borderBottom: 1,
    borderBottomColor: "#CCCCCC",
    borderBottomStyle: "solid",
    borderTopStyle: "solid",
    color: "#7d7d7d",
    flexDirection: "row",
    flexGrow: 1,
    fontWeight: 700,
    justifyContent: "space-between",
    padding: "6px 3px 6px 3px",
    textTransform: "uppercase"
  },
  thead: {
    alignItems: "center",
    borderBottom: 1,
    borderBottomColor: "#CCCCCC",
    borderBottomStyle: "solid",
    borderTop: 1,
    borderTopColor: "#CCCCCC",
    borderTopStyle: "solid",
    flexDirection: "row",
    flexGrow: 1,
    fontSize: 9,
    fontWeight: 700,
    justifyContent: "space-between",
    marginBottom: "10px",
    marginTop: "20px",
    padding: "6px 3px 6px 3px",
    textTransform: "uppercase"
  }
});
