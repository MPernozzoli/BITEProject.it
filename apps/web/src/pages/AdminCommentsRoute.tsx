import { lazy } from "react";

const AdminCommentsPage = lazy(() => import("@/components/admin/AdminCommentsPage"));

export default function AdminCommentsRoute() {
  return <AdminCommentsPage />;
}
