import { useState, useEffect } from "react";
import { toast } from "sonner";
import api from "@food/api";
import { Textarea } from "@food/components/ui/textarea";
import { legalHtmlToPlainText, plainTextToLegalHtml } from "@food/utils/legalContentFormat";

export default function PrivacyPolicy() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [viewMode, setViewMode] = useState("edit"); // "edit" | "preview"
  const [activeRole, setActiveRole] = useState("user"); // "user" | "restaurant" | "delivery"
  const [privacyData, setPrivacyData] = useState({
    title: "Privacy Policy",
    content: "",
  });
  const [initialData, setInitialData] = useState({
    title: "Privacy Policy",
    content: "",
  });

  const hasChanges = JSON.stringify(privacyData) !== JSON.stringify(initialData);

  useEffect(() => {
    fetchPrivacyData();
  }, [activeRole]);

  const fetchPrivacyData = async () => {
    try {
      setLoading(true);
      const key = activeRole === "user" ? "privacy" : `privacy_${activeRole}`;
      const response = await api.get(`/food/admin/pages-social-media/${key}`, { contextModule: "admin" });

      if (response.data.success && response.data.data) {
        const content = response.data.data.content || "";
        const textContent = legalHtmlToPlainText(content);
        const fetchedData = {
          title: response.data.data.title || `Privacy Policy - ${activeRole.charAt(0).toUpperCase() + activeRole.slice(1)}`,
          content: textContent,
        };
        setPrivacyData(fetchedData);
        setInitialData(fetchedData);
      } else {
        const defaultData = {
          title: `Privacy Policy - ${activeRole.charAt(0).toUpperCase() + activeRole.slice(1)}`,
          content: "",
        };
        setPrivacyData(defaultData);
        setInitialData(defaultData);
      }
    } catch (error) {
      console.error("Error fetching privacy data:", error);
      const errorData = {
        title: `Privacy Policy - ${activeRole.charAt(0).toUpperCase() + activeRole.slice(1)}`,
        content: "",
      };
      setPrivacyData(errorData);
      setInitialData(errorData);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      setSaving(true);
      const htmlContent = plainTextToLegalHtml(privacyData.content);
      const key = activeRole === "user" ? "privacy" : `privacy_${activeRole}`;

      const response = await api.put(
        `/food/admin/pages-social-media/${key}`,
        { title: privacyData.title, content: htmlContent },
        { contextModule: "admin" }
      );

      if (response.data.success) {
        toast.success(`${activeRole.charAt(0).toUpperCase() + activeRole.slice(1)} privacy policy updated successfully`);
        const content = response.data.data.content || "";
        const textContent = legalHtmlToPlainText(content);
        const savedData = {
          ...response.data.data,
          content: textContent,
        };
        setPrivacyData(savedData);
        setInitialData(savedData);
      }
    } catch (error) {
      console.error("Error saving privacy policy:", error);
      toast.error(error.response?.data?.message || "Failed to save privacy policy");
    } finally {
      setSaving(false);
    }
  };

  const getRoleLabel = (role) => role.charAt(0).toUpperCase() + role.slice(1);

  return (
    <div className="h-full overflow-y-auto bg-slate-50 p-4 lg:p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Privacy Policy</h1>
            <p className="text-sm text-slate-600 mt-1">Manage Privacy Policy content across all roles</p>
          </div>

          <div className="inline-flex p-1 bg-white border border-slate-200 rounded-xl shadow-sm">
            {["user", "restaurant", "delivery"].map((role) => (
              <button
                key={role}
                onClick={() => setActiveRole(role)}
                className={`px-6 py-2 text-sm font-semibold rounded-lg transition-all duration-200 ${
                  activeRole === role
                    ? "bg-orange-500 text-white shadow-md shadow-orange-500/20"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                }`}
              >
                {getRoleLabel(role)}
              </button>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="border-b border-slate-100 bg-slate-50/50 p-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-orange-500 animate-pulse"></span>
              <span className="text-sm font-medium text-slate-700">
                {viewMode === "preview" ? "Previewing" : "Editing"} {getRoleLabel(activeRole)} Portal Privacy
              </span>
            </div>

            <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1">
              <button
                type="button"
                onClick={() => setViewMode("edit")}
                className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-all ${
                  viewMode === "edit" ? "bg-slate-900 text-white shadow-sm" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Editor
              </button>
              <button
                type="button"
                onClick={() => setViewMode("preview")}
                className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-all ${
                  viewMode === "preview" ? "bg-slate-900 text-white shadow-sm" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Preview
              </button>
            </div>
          </div>

          <div className="p-6">
            {loading ? (
              <div className="min-h-[150px] flex flex-col items-center justify-center space-y-4">
                <div className="w-10 h-10 border-4 border-orange-500/30 border-t-orange-500 rounded-full animate-spin"></div>
                <p className="text-sm text-slate-500 font-medium italic">Synchronizing content...</p>
              </div>
            ) : (
              <>
                {viewMode === "edit" && (
                  <div className="mb-4">
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                      Page Title
                    </label>
                    <input
                      type="text"
                      value={privacyData.title}
                      onChange={(e) => setPrivacyData((prev) => ({ ...prev, title: e.target.value }))}
                      className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 text-slate-700 font-medium"
                    />
                  </div>
                )}

                {viewMode === "edit" ? (
                  <div className="relative group">
                    <Textarea
                      value={privacyData.content}
                      onChange={(e) => setPrivacyData((prev) => ({ ...prev, content: e.target.value }))}
                      placeholder={`Enter privacy policy for ${activeRole} here...`}
                      className="min-h-[150px] w-full text-sm text-slate-700 leading-relaxed resize-y border-slate-200 group-focus-within:border-orange-500 transition-colors bg-slate-50/30"
                    />
                  </div>
                ) : (
                  <div className="min-h-[150px] w-full bg-white">
                    <div
                      className="prose prose-orange max-w-none prose-headings:text-slate-900 prose-headings:font-bold prose-p:text-slate-600 prose-p:leading-7 prose-strong:text-slate-900 prose-ul:text-slate-600 prose-li:my-2 bg-slate-50/30 rounded-xl border border-slate-100 p-8"
                      dangerouslySetInnerHTML={{ __html: plainTextToLegalHtml(privacyData.content) }}
                    />
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {viewMode === "edit" && (
        <div className="flex items-center justify-between mt-8 p-6 bg-white border border-slate-200 rounded-2xl shadow-sm">
          <div className="text-sm text-slate-500">
            <span className="font-semibold text-slate-700">Tip:</span> Your changes are only published once you hit save.
          </div>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={saving || loading || !hasChanges}
            className="flex items-center gap-2 px-8 py-3 bg-orange-500 text-white rounded-xl hover:bg-orange-600 transition-all duration-200 font-bold shadow-lg shadow-orange-500/25 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none group"
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
        )}
      </div>
    </div>
  );
}
