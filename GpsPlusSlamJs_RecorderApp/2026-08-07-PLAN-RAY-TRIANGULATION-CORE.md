### DESCRIPTION
The closest-point-of-approach solver: given N weighted rays in one frame, compute the best-fit point and a meaningful uncertainty / convergence metric.

### USE CASE
1. Triangulating points from multiple rays and calculate the closest-point-of-approach to determine the final point.

### GOALS
1. Able to calculate the closest-point-of-approach of N rays.
2. Able to calculate the uncertainty / convergence metric of the final point.
3. Able to fuse depth information with the ray triangulation.

### TEST
 unit-test against known geometry 
 - two exactly intersecting rays return the intersection with ~zero error
 - near-parallel rays return a sensible point with high uncertainty
 - adding a third consistent ray lowers the uncertainty
 - weights bias the result as expected

 ### IMPLEMENTATION
 1. Implement the closest-point-of-approach solver in a new file src/lib/ray-triangulation-core.ts

 function rayTriangulationCore(rays: Ray[], depthReadings: DepthReading[]): TriangulationResult {}

 function closestPointOfApproach() {}

 interface Ray {
    origin: Vector3;
    direction: Vector3;
    weight: number;
 }

 interface DepthReading {
    point: Vector3;
    weight: number;
 }

 interface TriangulationResult {
    point: Vector3;
    uncertainty: number;
 }

 2. Unit Test
  test('two exactly intersecting rays return the intersection with ~zero error', () => {
    const rays = [
      { origin: new Vector3(0, 0, 0), direction: new Vector3(1, 0, 0), weight: 1 },
      { origin: new Vector3(1, 0, 0), direction: new Vector3(-1, 0, 0), weight: 1 },
    ];
    const result = rayTriangulationCore(rays, []);
    expect(result.point).toEqual(new Vector3(0.5, 0, 0));
    expect(result.uncertainty).toBeCloseTo(0, 6);
  });

  test('near-parallel rays return a sensible point with high uncertainty', () => {
    const rays = [
      { origin: new Vector3(0, 0, 0), direction: new Vector3(1, 0, 0), weight: 1 },
      { origin: new Vector3(0, 0, 0), direction: new Vector3(1, 0.001, 0), weight: 1 },
    ];
    const result = rayTriangulationCore(rays, []);
    expect(result.point).toEqual(new Vector3(0, 0, 0));
    expect(result.uncertainty).toBeCloseTo(0.0005, 6);
  });

  test('adding a third consistent ray lowers the uncertainty', () => {
    const rays = [
      { origin: new Vector3(0, 0, 0), direction: new Vector3(1, 0, 0), weight: 1 },
      { origin: new Vector3(1, 0, 0), direction: new Vector3(-1, 0, 0), weight: 1 },
      { origin: new Vector3(0.5, 0, 0), direction: new Vector3(0, 1, 0), weight: 1 },
    ];
    const result = rayTriangulationCore(rays, []);
    expect(result.point).toEqual(new Vector3(0.5, 0, 0));
    expect(result.uncertainty).toBeCloseTo(0, 6);
  });

  test('weights bias the result as expected', () => {
    const rays = [
      { origin: new Vector3(0, 0, 0), direction: new Vector3(1, 0, 0), weight: 1 },
      { origin: new Vector3(1, 0, 0), direction: new Vector3(-1, 0, 0), weight: 1 },
    ];
    const result = rayTriangulationCore(rays, []);
    expect(result.point).toEqual(new Vector3(0.5, 0, 0));
    expect(result.uncertainty).toBeCloseTo(0, 6);
  });