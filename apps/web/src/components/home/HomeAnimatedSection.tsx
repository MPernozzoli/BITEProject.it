import { motion, type Variants } from "framer-motion";

const easeOutExpo: [number, number, number, number] = [0.16, 1, 0.3, 1];

export const homeSectionVariants: Variants = {
  hidden: { opacity: 0, y: 28 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.62, ease: easeOutExpo },
  },
};

export const topicsContainerVariants: Variants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.09, delayChildren: 0.06 },
  },
};

export const topicItemVariants: Variants = {
  hidden: { opacity: 0, y: 18 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.52, ease: easeOutExpo },
  },
};

type HomeAnimatedSectionProps = {
  className?: string;
  children: React.ReactNode;
};

export function HomeAnimatedSection({ className, children }: HomeAnimatedSectionProps) {
  return (
    <motion.section
      className={className}
      variants={homeSectionVariants}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: "-48px", amount: 0.08 }}
    >
      {children}
    </motion.section>
  );
}
