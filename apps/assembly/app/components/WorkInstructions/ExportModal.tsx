import {
  Button,
  Input,
  Label,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@carbon/react";
import { useState } from "react";
import {
  BsClipboard,
  BsDownload,
  BsEnvelope,
  BsFilePdf,
  BsLink45Deg,
  BsPhone,
  BsPlayCircle,
  BsQrCode,
  BsShare
} from "react-icons/bs";
import { useFetcher } from "react-router";

interface ShareLink {
  id: string;
  token: string;
  expiresAt: string | null;
  password: string | null;
  allowDownload: boolean;
  createdAt: string;
}

interface ExportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  shareLinks: ShareLink[];
}

type ExportTab = "video" | "pdf" | "share" | "mobile";

export function ExportModal({
  open,
  onOpenChange,
  projectId,
  shareLinks
}: ExportModalProps) {
  const [activeTab, setActiveTab] = useState<ExportTab>("share");
  const [showShareForm, setShowShareForm] = useState(false);
  const fetcher = useFetcher();
  const isSubmitting = fetcher.state !== "idle";

  const baseUrl =
    typeof window !== "undefined"
      ? window.location.origin
      : "https://assembly.carbon.ms";

  const tabs: { id: ExportTab; label: string; icon: React.ReactNode }[] = [
    {
      id: "share",
      label: "Share",
      icon: <BsShare className="w-4 h-4" />
    },
    {
      id: "video",
      label: "Video",
      icon: <BsPlayCircle className="w-4 h-4" />
    },
    {
      id: "pdf",
      label: "PDF",
      icon: <BsFilePdf className="w-4 h-4" />
    },
    {
      id: "mobile",
      label: "Mobile",
      icon: <BsPhone className="w-4 h-4" />
    }
  ];

  const handleCreateShareLink = (formData: FormData) => {
    formData.set("intent", "createShareLink");
    fetcher.submit(formData, { method: "post" });
    setShowShareForm(false);
  };

  const handleExportVideo = (formData: FormData) => {
    formData.set("intent", "exportVideo");
    fetcher.submit(formData, { method: "post" });
  };

  const handleExportPdf = () => {
    const formData = new FormData();
    formData.set("intent", "exportPdf");
    fetcher.submit(formData, { method: "post" });
  };

  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent size="xlarge">
        <ModalHeader>
          <ModalTitle>Export & Share</ModalTitle>
          <ModalDescription>
            Share your assembly instructions or export them in different
            formats.
          </ModalDescription>
        </ModalHeader>

        <ModalBody>
          {/* Tab Navigation */}
          <div className="flex gap-1 border-b border-border mb-6">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 ${
                  activeTab === tab.id
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>

          {/* Share Tab */}
          {activeTab === "share" && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Create shareable links for operators to view instructions on any
                device.
              </p>

              {/* Existing Links */}
              {shareLinks.length > 0 && (
                <div className="space-y-2">
                  {shareLinks.map((link) => (
                    <div
                      key={link.id}
                      className="flex items-center justify-between p-3 bg-muted rounded-lg"
                    >
                      <div className="flex items-center gap-3">
                        <BsLink45Deg className="w-4 h-4 text-muted-foreground" />
                        <div>
                          <code className="text-sm">
                            {baseUrl}/share/{link.token.slice(0, 8)}...
                          </code>
                          <p className="text-xs text-muted-foreground">
                            {link.expiresAt
                              ? `Expires: ${new Date(link.expiresAt).toLocaleDateString()}`
                              : "No expiration"}
                            {link.password && " | Password protected"}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            navigator.clipboard.writeText(
                              `${baseUrl}/share/${link.token}`
                            );
                          }}
                        >
                          <BsClipboard className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="sm">
                          <BsQrCode className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Create New Link */}
              {showShareForm ? (
                <ShareLinkForm
                  onSubmit={handleCreateShareLink}
                  onCancel={() => setShowShareForm(false)}
                  isSubmitting={isSubmitting}
                />
              ) : (
                <Button
                  variant="secondary"
                  onClick={() => setShowShareForm(true)}
                >
                  <BsLink45Deg className="w-4 h-4 mr-2" />
                  Create New Share Link
                </Button>
              )}
            </div>
          )}

          {/* Video Tab */}
          {activeTab === "video" && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Generate a video of the full assembly sequence with all
                animations and annotations.
              </p>
              <VideoExportForm
                onSubmit={handleExportVideo}
                isSubmitting={isSubmitting}
              />
            </div>
          )}

          {/* PDF Tab */}
          {activeTab === "pdf" && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Generate a printable PDF document with step-by-step instructions
                and images.
              </p>
              <Button
                variant="secondary"
                onClick={handleExportPdf}
                disabled={isSubmitting}
              >
                <BsDownload className="w-4 h-4 mr-2" />
                Download PDF
              </Button>
            </div>
          )}

          {/* Mobile Tab */}
          {activeTab === "mobile" && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Operators can view instructions on mobile devices using share
                links. The viewer is optimized for touch screens.
              </p>
              <div className="flex flex-col gap-3 mt-2">
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                  <BsQrCode className="w-5 h-5" />
                  Scan QR code on printed labels
                </div>
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                  <BsEnvelope className="w-5 h-5" />
                  Email links to team members
                </div>
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                  <BsPhone className="w-5 h-5" />
                  Responsive viewer for all screen sizes
                </div>
              </div>
            </div>
          )}
        </ModalBody>

        <ModalFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

function ShareLinkForm({
  onSubmit,
  onCancel,
  isSubmitting
}: {
  onSubmit: (data: FormData) => void;
  onCancel: () => void;
  isSubmitting: boolean;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(new FormData(e.currentTarget));
      }}
      className="p-4 border rounded-lg space-y-4"
    >
      <div>
        <Label>Link Expiration</Label>
        <Select name="expiresInDays" defaultValue="30">
          <SelectTrigger className="mt-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">Never expires</SelectItem>
            <SelectItem value="7">7 days</SelectItem>
            <SelectItem value="30">30 days</SelectItem>
            <SelectItem value="90">90 days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label>Password (optional)</Label>
        <Input
          name="password"
          type="password"
          placeholder="Leave empty for no password"
          className="mt-1"
        />
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          name="allowDownload"
          value="true"
          id="modal-allowDownload"
        />
        <Label htmlFor="modal-allowDownload" className="text-sm font-normal">
          Allow viewers to download video
        </Label>
      </div>

      <div className="flex gap-2">
        <Button type="submit" disabled={isSubmitting}>
          Create Link
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function VideoExportForm({
  onSubmit,
  isSubmitting
}: {
  onSubmit: (data: FormData) => void;
  isSubmitting: boolean;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(new FormData(e.currentTarget));
      }}
      className="space-y-4"
    >
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Resolution</Label>
          <Select name="resolution" defaultValue="1080p">
            <SelectTrigger className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="720p">720p (HD)</SelectItem>
              <SelectItem value="1080p">1080p (Full HD)</SelectItem>
              <SelectItem value="4k">4K (Ultra HD)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Frame Rate</Label>
          <Select name="fps" defaultValue="30">
            <SelectTrigger className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="24">24 fps</SelectItem>
              <SelectItem value="30">30 fps</SelectItem>
              <SelectItem value="60">60 fps</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Button type="submit" disabled={isSubmitting}>
        <BsDownload className="w-4 h-4 mr-2" />
        Export Video
      </Button>
    </form>
  );
}
