import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

const ContactRedirect = () => {
  const navigate = useNavigate();
  
  useEffect(() => {
    window.location.href = "https://biteproject.it/contact";
  }, []);

  return (
    <div className="min-h-[50vh] flex items-center justify-center">
      <p className="text-sm font-sans text-muted-foreground">Redirecting to BITE Project contact page...</p>
    </div>
  );
};

export default ContactRedirect;
