import { Navigate } from "react-router-dom";

// Admin login is now unified with user login
const AdminLogin = () => {
  return <Navigate to="/login" state={{ from: "/admin" }} replace />;
};

export default AdminLogin;
