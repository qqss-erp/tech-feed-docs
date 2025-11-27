import type {ReactNode} from 'react';
import clsx from 'clsx';
import Heading from '@theme/Heading';
import styles from './styles.module.css';

type FeatureItem = {
  title: string;
  Svg: React.ComponentType<React.ComponentProps<'svg'>>;
  description: ReactNode;
};

const FeatureList: FeatureItem[] = [
    {
        title: 'Streamline Operations',
        Svg: require('@site/static/img/undraw_docusaurus_mountain.svg').default,
        description: (
            <>
                Upgrade your manufacturing business with cutting-edge MES and ERP solutions. DMeX Solutions is your dedicated partner for achieving digital transformation.
            </>
        ),
    },
    {
        title: 'Empower Every Role',
        Svg: require('@site/static/img/undraw_docusaurus_tree.svg').default,
        description: (
            <>
                From production planners to finance professionals, our Industry 4.0 solutions cater to every user persona, optimizing workflows across departments.
            </>
        ),
    },
    {
        title: 'Drive Digital Excellence',
        Svg: require('@site/static/img/undraw_docusaurus_react.svg').default,
        description: (
            <>
                DMeX Solutions enables fast, structured, and scalable digitalization—ensuring efficient data handling, machine monitoring, and automated workflows.
            </>
        ),
    },
];

function Feature({title, Svg, description}: FeatureItem) {
  return (
    <div className={clsx('col col--4')}>
      <div className="text--center">
        <Svg className={styles.featureSvg} role="img" />
      </div>
      <div className="text--center padding-horiz--md">
        <Heading as="h3">{title}</Heading>
        <p>{description}</p>
      </div>
    </div>
  );
}

export default function HomepageFeatures(): ReactNode {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className="row">
          {FeatureList.map((props, idx) => (
            <Feature key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}
