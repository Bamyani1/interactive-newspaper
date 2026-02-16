import "../../../font-color/styles/font-color-kit.css";
import ColorCustomizer from "../../../font-color/components/ColorCustomizer";
import FontCustomizer from "../../../font-color/components/FontCustomizer";
import SidebarCustomizer from "../../../font-color/components/SidebarCustomizer";
import LayoutCustomizer from "../../../font-color/components/LayoutCustomizer";

export default function EditionLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      {children}
      <ColorCustomizer />
      <FontCustomizer />
      <SidebarCustomizer />
      <LayoutCustomizer />
    </>
  );
}
